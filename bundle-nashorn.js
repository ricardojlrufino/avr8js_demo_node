(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
exports.AVRRunner = void 0;

// var avr8js_1 = require('../../dist/cjs');
var avr8js_1 = require('avr8js');

var intelhex_1 = require("./intelhex");

// var task_scheduler_1 = require("./task-scheduler"); // ATmega328p params

var { MicroTaskScheduler } = require('./task-scheduler');

var FLASH = 0x8000;

class AVRRunner {
  varructor(hex) {
    this.program = new Uint16Array(FLASH);
    this.speed = 16e6; // 16 MHZ

    this.workUnitCycles = 500000;
    this.taskScheduler = new MicroTaskScheduler();
    intelhex_1.loadHex(hex, new Uint8Array(this.program.buffer));
    this.cpu = new avr8js_1.CPU(this.program);
    this.timer0 = new avr8js_1.AVRTimer(this.cpu, avr8js_1.timer0Config);
    this.timer1 = new avr8js_1.AVRTimer(this.cpu, avr8js_1.timer1Config);
    this.timer2 = new avr8js_1.AVRTimer(this.cpu, avr8js_1.timer2Config);
    this.portB = new avr8js_1.AVRIOPort(this.cpu, avr8js_1.portBConfig);
    this.portC = new avr8js_1.AVRIOPort(this.cpu, avr8js_1.portCConfig);
    this.portD = new avr8js_1.AVRIOPort(this.cpu, avr8js_1.portDConfig);
    this.usart = new avr8js_1.AVRUSART(this.cpu, avr8js_1.usart0Config, this.speed);
    this.taskScheduler.start();
  } // CPU main loop


  execute(callback) {
    var cyclesToRun = this.cpu.cycles + this.workUnitCycles;

    while (this.cpu.cycles < cyclesToRun) {
      avr8js_1.avrInstruction(this.cpu);
      this.timer0.tick();
      this.timer1.tick();
      this.timer2.tick();
      this.usart.tick();
    }

    callback(this.cpu);
    this.taskScheduler.postTask(() => this.execute(callback));
  }

  stop() {
    this.taskScheduler.stop();
  }

}

exports.AVRRunner = AVRRunner;
},{"./intelhex":2,"./task-scheduler":14,"avr8js":6}],2:[function(require,module,exports){
exports.loadHex = void 0;

function loadHex(source, target) {
  for (var line of source.split('\n')) {
    if (line[0] === ':' && line.substr(7, 2) === '00') {
      var bytes = parseInt(line.substr(1, 2), 16);
      var addr = parseInt(line.substr(3, 4), 16);

      for (let i = 0; i < bytes; i++) {
        target[addr + i] = parseInt(line.substr(9 + i * 2, 2), 16);
      }
    }
  }
}

exports.loadHex = loadHex;
},{}],3:[function(require,module,exports){
"use strict";
/**
 * AVR 8 CPU data structures
 * Part of AVR8js
 *
 * Copyright (C) 2019, Uri Shaked
 */
Object.defineProperty(exports, "__esModule", { value: true });
var registerSpace = 0x100;
class CPU {
    varructor(progMem, sramBytes = 8192) {
        this.progMem = progMem;
        this.sramBytes = sramBytes;
        this.data = new Uint8Array(this.sramBytes + registerSpace);
        this.data16 = new Uint16Array(this.data.buffer);
        this.dataView = new DataView(this.data.buffer);
        this.progBytes = new Uint8Array(this.progMem.buffer);
        this.readHooks = [];
        this.writeHooks = [];
        this.pc22Bits = this.progBytes.length > 0x20000;
        // This lets the Timer Compare output override GPIO pins:
        this.gpioTimerHooks = [];
        this.pc = 0;
        this.cycles = 0;
        this.reset();
    }
    reset() {
        this.data.fill(0);
        this.SP = this.data.length - 1;
    }
    readData(addr) {
        if (addr >= 32 && this.readHooks[addr]) {
            return this.readHooks[addr](addr);
        }
        return this.data[addr];
    }
    writeData(addr, value) {
        var hook = this.writeHooks[addr];
        if (hook) {
            if (hook(value, this.data[addr], addr)) {
                return;
            }
        }
        this.data[addr] = value;
    }
    get SP() {
        return this.dataView.getUint16(93, true);
    }
    set SP(value) {
        this.dataView.setUint16(93, value, true);
    }
    get SREG() {
        return this.data[95];
    }
    get interruptsEnabled() {
        return this.SREG & 0x80 ? true : false;
    }
}
exports.CPU = CPU;

},{}],4:[function(require,module,exports){
"use strict";
/**
 * AVR-8 Instruction Simulation
 * Part of AVR8js
 *
 * Reference: http://ww1.microchip.com/downloads/en/devicedoc/atmel-0856-avr-instruction-set-manual.pdf
 *
 * Instruction timing is currently based on ATmega328p (see the Instruction Set Summary at the end of
 * the datasheet)
 *
 * Copyright (C) 2019, 2020 Uri Shaked
 */
Object.defineProperty(exports, "__esModule", { value: true });
function isTwoWordInstruction(opcode) {
    return (
    /* LDS */
    (opcode & 0xfe0f) === 0x9000 ||
        /* STS */
        (opcode & 0xfe0f) === 0x9200 ||
        /* CALL */
        (opcode & 0xfe0e) === 0x940e ||
        /* JMP */
        (opcode & 0xfe0e) === 0x940c);
}
function avrInstruction(cpu) {
    var opcode = cpu.progMem[cpu.pc];
    if ((opcode & 0xfc00) === 0x1c00) {
        /* ADC, 0001 11rd dddd rrrr */
        var d = cpu.data[(opcode & 0x1f0) >> 4];
        var r = cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        var sum = d + r + (cpu.data[95] & 1);
        var R = sum & 255;
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xc0;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (R ^ r) & (d ^ R) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= sum & 256 ? 1 : 0;
        sreg |= 1 & ((d & r) | (r & ~R) | (~R & d)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfc00) === 0xc00) {
        /* ADD, 0000 11rd dddd rrrr */
        var d = cpu.data[(opcode & 0x1f0) >> 4];
        var r = cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        var R = (d + r) & 255;
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xc0;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (R ^ r) & (R ^ d) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= (d + r) & 256 ? 1 : 0;
        sreg |= 1 & ((d & r) | (r & ~R) | (~R & d)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xff00) === 0x9600) {
        /* ADIW, 1001 0110 KKdd KKKK */
        var addr = 2 * ((opcode & 0x30) >> 4) + 24;
        var value = cpu.dataView.getUint16(addr, true);
        var R = (value + ((opcode & 0xf) | ((opcode & 0xc0) >> 2))) & 0xffff;
        cpu.dataView.setUint16(addr, R, true);
        let sreg = cpu.data[95] & 0xe0;
        sreg |= R ? 0 : 2;
        sreg |= 0x8000 & R ? 4 : 0;
        sreg |= ~value & R & 0x8000 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= ~R & value & 0x8000 ? 1 : 0;
        cpu.data[95] = sreg;
        cpu.cycles++;
    }
    else if ((opcode & 0xfc00) === 0x2000) {
        /* AND, 0010 00rd dddd rrrr */
        var R = cpu.data[(opcode & 0x1f0) >> 4] & cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xe1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xf000) === 0x7000) {
        /* ANDI, 0111 KKKK dddd KKKK */
        var R = cpu.data[((opcode & 0xf0) >> 4) + 16] & ((opcode & 0xf) | ((opcode & 0xf00) >> 4));
        cpu.data[((opcode & 0xf0) >> 4) + 16] = R;
        let sreg = cpu.data[95] & 0xe1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfe0f) === 0x9405) {
        /* ASR, 1001 010d dddd 0101 */
        var value = cpu.data[(opcode & 0x1f0) >> 4];
        var R = (value >>> 1) | (128 & value);
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xe0;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= value & 1;
        sreg |= ((sreg >> 2) & 1) ^ (sreg & 1) ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xff8f) === 0x9488) {
        /* BCLR, 1001 0100 1sss 1000 */
        cpu.data[95] &= ~(1 << ((opcode & 0x70) >> 4));
    }
    else if ((opcode & 0xfe08) === 0xf800) {
        /* BLD, 1111 100d dddd 0bbb */
        var b = opcode & 7;
        var d = (opcode & 0x1f0) >> 4;
        cpu.data[d] = (~(1 << b) & cpu.data[d]) | (((cpu.data[95] >> 6) & 1) << b);
    }
    else if ((opcode & 0xfc00) === 0xf400) {
        /* BRBC, 1111 01kk kkkk ksss */
        if (!(cpu.data[95] & (1 << (opcode & 7)))) {
            cpu.pc = cpu.pc + (((opcode & 0x1f8) >> 3) - (opcode & 0x200 ? 0x40 : 0));
            cpu.cycles++;
        }
    }
    else if ((opcode & 0xfc00) === 0xf000) {
        /* BRBS, 1111 00kk kkkk ksss */
        if (cpu.data[95] & (1 << (opcode & 7))) {
            cpu.pc = cpu.pc + (((opcode & 0x1f8) >> 3) - (opcode & 0x200 ? 0x40 : 0));
            cpu.cycles++;
        }
    }
    else if ((opcode & 0xff8f) === 0x9408) {
        /* BSET, 1001 0100 0sss 1000 */
        cpu.data[95] |= 1 << ((opcode & 0x70) >> 4);
    }
    else if ((opcode & 0xfe08) === 0xfa00) {
        /* BST, 1111 101d dddd 0bbb */
        var d = cpu.data[(opcode & 0x1f0) >> 4];
        var b = opcode & 7;
        cpu.data[95] = (cpu.data[95] & 0xbf) | ((d >> b) & 1 ? 0x40 : 0);
    }
    else if ((opcode & 0xfe0e) === 0x940e) {
        /* CALL, 1001 010k kkkk 111k kkkk kkkk kkkk kkkk */
        var k = cpu.progMem[cpu.pc + 1] | ((opcode & 1) << 16) | ((opcode & 0x1f0) << 13);
        var ret = cpu.pc + 2;
        var sp = cpu.dataView.getUint16(93, true);
        var { pc22Bits } = cpu;
        cpu.data[sp] = 255 & ret;
        cpu.data[sp - 1] = (ret >> 8) & 255;
        if (pc22Bits) {
            cpu.data[sp - 2] = (ret >> 16) & 255;
        }
        cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
        cpu.pc = k - 1;
        cpu.cycles += pc22Bits ? 4 : 3;
    }
    else if ((opcode & 0xff00) === 0x9800) {
        /* CBI, 1001 1000 AAAA Abbb */
        var A = opcode & 0xf8;
        var b = opcode & 7;
        var R = cpu.readData((A >> 3) + 32);
        cpu.writeData((A >> 3) + 32, R & ~(1 << b));
    }
    else if ((opcode & 0xfe0f) === 0x9400) {
        /* COM, 1001 010d dddd 0000 */
        var d = (opcode & 0x1f0) >> 4;
        var R = 255 - cpu.data[d];
        cpu.data[d] = R;
        let sreg = (cpu.data[95] & 0xe1) | 1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfc00) === 0x1400) {
        /* CP, 0001 01rd dddd rrrr */
        var val1 = cpu.data[(opcode & 0x1f0) >> 4];
        var val2 = cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        var R = val1 - val2;
        let sreg = cpu.data[95] & 0xc0;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= 0 !== ((val1 ^ val2) & (val1 ^ R) & 128) ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= val2 > val1 ? 1 : 0;
        sreg |= 1 & ((~val1 & val2) | (val2 & R) | (R & ~val1)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfc00) === 0x400) {
        /* CPC, 0000 01rd dddd rrrr */
        var arg1 = cpu.data[(opcode & 0x1f0) >> 4];
        var arg2 = cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        let sreg = cpu.data[95];
        var r = arg1 - arg2 - (sreg & 1);
        sreg = (sreg & 0xc0) | (!r && (sreg >> 1) & 1 ? 2 : 0) | (arg2 + (sreg & 1) > arg1 ? 1 : 0);
        sreg |= 128 & r ? 4 : 0;
        sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= 1 & ((~arg1 & arg2) | (arg2 & r) | (r & ~arg1)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xf000) === 0x3000) {
        /* CPI, 0011 KKKK dddd KKKK */
        var arg1 = cpu.data[((opcode & 0xf0) >> 4) + 16];
        var arg2 = (opcode & 0xf) | ((opcode & 0xf00) >> 4);
        var r = arg1 - arg2;
        let sreg = cpu.data[95] & 0xc0;
        sreg |= r ? 0 : 2;
        sreg |= 128 & r ? 4 : 0;
        sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= arg2 > arg1 ? 1 : 0;
        sreg |= 1 & ((~arg1 & arg2) | (arg2 & r) | (r & ~arg1)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfc00) === 0x1000) {
        /* CPSE, 0001 00rd dddd rrrr */
        if (cpu.data[(opcode & 0x1f0) >> 4] === cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)]) {
            var nextOpcode = cpu.progMem[cpu.pc + 1];
            var skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.pc += skipSize;
            cpu.cycles += skipSize;
        }
    }
    else if ((opcode & 0xfe0f) === 0x940a) {
        /* DEC, 1001 010d dddd 1010 */
        var value = cpu.data[(opcode & 0x1f0) >> 4];
        var R = value - 1;
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xe1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= 128 === value ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if (opcode === 0x9519) {
        /* EICALL, 1001 0101 0001 1001 */
        var retAddr = cpu.pc + 1;
        var sp = cpu.dataView.getUint16(93, true);
        var eind = cpu.data[0x3c];
        cpu.data[sp] = retAddr & 255;
        cpu.data[sp - 1] = (retAddr >> 8) & 255;
        cpu.dataView.setUint16(93, sp - 2, true);
        cpu.pc = ((eind << 16) | cpu.dataView.getUint16(30, true)) - 1;
        cpu.cycles += 3;
    }
    else if (opcode === 0x9419) {
        /* EIJMP, 1001 0100 0001 1001 */
        var eind = cpu.data[0x3c];
        cpu.pc = ((eind << 16) | cpu.dataView.getUint16(30, true)) - 1;
        cpu.cycles++;
    }
    else if (opcode === 0x95d8) {
        /* ELPM, 1001 0101 1101 1000 */
        var rampz = cpu.data[0x3b];
        cpu.data[0] = cpu.progBytes[(rampz << 16) | cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
    }
    else if ((opcode & 0xfe0f) === 0x9006) {
        /* ELPM(REG), 1001 000d dddd 0110 */
        var rampz = cpu.data[0x3b];
        cpu.data[(opcode & 0x1f0) >> 4] =
            cpu.progBytes[(rampz << 16) | cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
    }
    else if ((opcode & 0xfe0f) === 0x9007) {
        /* ELPM(INC), 1001 000d dddd 0111 */
        var rampz = cpu.data[0x3b];
        var i = cpu.dataView.getUint16(30, true);
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.progBytes[(rampz << 16) | i];
        cpu.dataView.setUint16(30, i + 1, true);
        if (i === 0xffff) {
            cpu.data[0x3b] = (rampz + 1) % (cpu.progBytes.length >> 16);
        }
        cpu.cycles += 2;
    }
    else if ((opcode & 0xfc00) === 0x2400) {
        /* EOR, 0010 01rd dddd rrrr */
        var R = cpu.data[(opcode & 0x1f0) >> 4] ^ cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xe1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xff88) === 0x308) {
        /* FMUL, 0000 0011 0ddd 1rrr */
        var v1 = cpu.data[((opcode & 0x70) >> 4) + 16];
        var v2 = cpu.data[(opcode & 7) + 16];
        var R = (v1 * v2) << 1;
        cpu.dataView.setUint16(0, R, true);
        cpu.data[95] = (cpu.data[95] & 0xfc) | (0xffff & R ? 0 : 2) | ((v1 * v2) & 0x8000 ? 1 : 0);
        cpu.cycles++;
    }
    else if ((opcode & 0xff88) === 0x380) {
        /* FMULS, 0000 0011 1ddd 0rrr */
        var v1 = cpu.dataView.getInt8(((opcode & 0x70) >> 4) + 16);
        var v2 = cpu.dataView.getInt8((opcode & 7) + 16);
        var R = (v1 * v2) << 1;
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = (cpu.data[95] & 0xfc) | (0xffff & R ? 0 : 2) | ((v1 * v2) & 0x8000 ? 1 : 0);
        cpu.cycles++;
    }
    else if ((opcode & 0xff88) === 0x388) {
        /* FMULSU, 0000 0011 1ddd 1rrr */
        var v1 = cpu.dataView.getInt8(((opcode & 0x70) >> 4) + 16);
        var v2 = cpu.data[(opcode & 7) + 16];
        var R = (v1 * v2) << 1;
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = (cpu.data[95] & 0xfc) | (0xffff & R ? 2 : 0) | ((v1 * v2) & 0x8000 ? 1 : 0);
        cpu.cycles++;
    }
    else if (opcode === 0x9509) {
        /* ICALL, 1001 0101 0000 1001 */
        var retAddr = cpu.pc + 1;
        var sp = cpu.dataView.getUint16(93, true);
        var { pc22Bits } = cpu;
        cpu.data[sp] = retAddr & 255;
        cpu.data[sp - 1] = (retAddr >> 8) & 255;
        if (pc22Bits) {
            cpu.data[sp - 2] = (retAddr >> 16) & 255;
        }
        cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
        cpu.pc = cpu.dataView.getUint16(30, true) - 1;
        cpu.cycles += pc22Bits ? 3 : 2;
    }
    else if (opcode === 0x9409) {
        /* IJMP, 1001 0100 0000 1001 */
        cpu.pc = cpu.dataView.getUint16(30, true) - 1;
        cpu.cycles++;
    }
    else if ((opcode & 0xf800) === 0xb000) {
        /* IN, 1011 0AAd dddd AAAA */
        var i = cpu.readData(((opcode & 0xf) | ((opcode & 0x600) >> 5)) + 32);
        cpu.data[(opcode & 0x1f0) >> 4] = i;
    }
    else if ((opcode & 0xfe0f) === 0x9403) {
        /* INC, 1001 010d dddd 0011 */
        var d = cpu.data[(opcode & 0x1f0) >> 4];
        var r = (d + 1) & 255;
        cpu.data[(opcode & 0x1f0) >> 4] = r;
        let sreg = cpu.data[95] & 0xe1;
        sreg |= r ? 0 : 2;
        sreg |= 128 & r ? 4 : 0;
        sreg |= 127 === d ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfe0e) === 0x940c) {
        /* JMP, 1001 010k kkkk 110k kkkk kkkk kkkk kkkk */
        cpu.pc = (cpu.progMem[cpu.pc + 1] | ((opcode & 1) << 16) | ((opcode & 0x1f0) << 13)) - 1;
        cpu.cycles += 2;
    }
    else if ((opcode & 0xfe0f) === 0x9206) {
        /* LAC, 1001 001r rrrr 0110 */
        var r = (opcode & 0x1f0) >> 4;
        var clear = cpu.data[r];
        var value = cpu.readData(cpu.dataView.getUint16(30, true));
        cpu.writeData(cpu.dataView.getUint16(30, true), value & (255 - clear));
        cpu.data[r] = value;
    }
    else if ((opcode & 0xfe0f) === 0x9205) {
        /* LAS, 1001 001r rrrr 0101 */
        var r = (opcode & 0x1f0) >> 4;
        var set = cpu.data[r];
        var value = cpu.readData(cpu.dataView.getUint16(30, true));
        cpu.writeData(cpu.dataView.getUint16(30, true), value | set);
        cpu.data[r] = value;
    }
    else if ((opcode & 0xfe0f) === 0x9207) {
        /* LAT, 1001 001r rrrr 0111 */
        var r = cpu.data[(opcode & 0x1f0) >> 4];
        var R = cpu.readData(cpu.dataView.getUint16(30, true));
        cpu.writeData(cpu.dataView.getUint16(30, true), r ^ R);
        cpu.data[(opcode & 0x1f0) >> 4] = R;
    }
    else if ((opcode & 0xf000) === 0xe000) {
        /* LDI, 1110 KKKK dddd KKKK */
        cpu.data[((opcode & 0xf0) >> 4) + 16] = (opcode & 0xf) | ((opcode & 0xf00) >> 4);
    }
    else if ((opcode & 0xfe0f) === 0x9000) {
        /* LDS, 1001 000d dddd 0000 kkkk kkkk kkkk kkkk */
        cpu.cycles++;
        var value = cpu.readData(cpu.progMem[cpu.pc + 1]);
        cpu.data[(opcode & 0x1f0) >> 4] = value;
        cpu.pc++;
    }
    else if ((opcode & 0xfe0f) === 0x900c) {
        /* LDX, 1001 000d dddd 1100 */
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(cpu.dataView.getUint16(26, true));
    }
    else if ((opcode & 0xfe0f) === 0x900d) {
        /* LDX(INC), 1001 000d dddd 1101 */
        var x = cpu.dataView.getUint16(26, true);
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(x);
        cpu.dataView.setUint16(26, x + 1, true);
    }
    else if ((opcode & 0xfe0f) === 0x900e) {
        /* LDX(DEC), 1001 000d dddd 1110 */
        var x = cpu.dataView.getUint16(26, true) - 1;
        cpu.dataView.setUint16(26, x, true);
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(x);
    }
    else if ((opcode & 0xfe0f) === 0x8008) {
        /* LDY, 1000 000d dddd 1000 */
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(cpu.dataView.getUint16(28, true));
    }
    else if ((opcode & 0xfe0f) === 0x9009) {
        /* LDY(INC), 1001 000d dddd 1001 */
        var y = cpu.dataView.getUint16(28, true);
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(y);
        cpu.dataView.setUint16(28, y + 1, true);
    }
    else if ((opcode & 0xfe0f) === 0x900a) {
        /* LDY(DEC), 1001 000d dddd 1010 */
        var y = cpu.dataView.getUint16(28, true) - 1;
        cpu.dataView.setUint16(28, y, true);
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(y);
    }
    else if ((opcode & 0xd208) === 0x8008 &&
        (opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)) {
        /* LDDY, 10q0 qq0d dddd 1qqq */
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(cpu.dataView.getUint16(28, true) +
            ((opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)));
    }
    else if ((opcode & 0xfe0f) === 0x8000) {
        /* LDZ, 1000 000d dddd 0000 */
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(cpu.dataView.getUint16(30, true));
    }
    else if ((opcode & 0xfe0f) === 0x9001) {
        /* LDZ(INC), 1001 000d dddd 0001 */
        var z = cpu.dataView.getUint16(30, true);
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(z);
        cpu.dataView.setUint16(30, z + 1, true);
    }
    else if ((opcode & 0xfe0f) === 0x9002) {
        /* LDZ(DEC), 1001 000d dddd 0010 */
        var z = cpu.dataView.getUint16(30, true) - 1;
        cpu.dataView.setUint16(30, z, true);
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(z);
    }
    else if ((opcode & 0xd208) === 0x8000 &&
        (opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)) {
        /* LDDZ, 10q0 qq0d dddd 0qqq */
        cpu.cycles++;
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.readData(cpu.dataView.getUint16(30, true) +
            ((opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)));
    }
    else if (opcode === 0x95c8) {
        /* LPM, 1001 0101 1100 1000 */
        cpu.data[0] = cpu.progBytes[cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
    }
    else if ((opcode & 0xfe0f) === 0x9004) {
        /* LPM(REG), 1001 000d dddd 0100 */
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.progBytes[cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
    }
    else if ((opcode & 0xfe0f) === 0x9005) {
        /* LPM(INC), 1001 000d dddd 0101 */
        var i = cpu.dataView.getUint16(30, true);
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.progBytes[i];
        cpu.dataView.setUint16(30, i + 1, true);
        cpu.cycles += 2;
    }
    else if ((opcode & 0xfe0f) === 0x9406) {
        /* LSR, 1001 010d dddd 0110 */
        var value = cpu.data[(opcode & 0x1f0) >> 4];
        var R = value >>> 1;
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xe0;
        sreg |= R ? 0 : 2;
        sreg |= value & 1;
        sreg |= ((sreg >> 2) & 1) ^ (sreg & 1) ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfc00) === 0x2c00) {
        /* MOV, 0010 11rd dddd rrrr */
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
    }
    else if ((opcode & 0xff00) === 0x100) {
        /* MOVW, 0000 0001 dddd rrrr */
        var r2 = 2 * (opcode & 0xf);
        var d2 = 2 * ((opcode & 0xf0) >> 4);
        cpu.data[d2] = cpu.data[r2];
        cpu.data[d2 + 1] = cpu.data[r2 + 1];
    }
    else if ((opcode & 0xfc00) === 0x9c00) {
        /* MUL, 1001 11rd dddd rrrr */
        var R = cpu.data[(opcode & 0x1f0) >> 4] * cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        cpu.dataView.setUint16(0, R, true);
        cpu.data[95] = (cpu.data[95] & 0xfc) | (0xffff & R ? 0 : 2) | (0x8000 & R ? 1 : 0);
        cpu.cycles++;
    }
    else if ((opcode & 0xff00) === 0x200) {
        /* MULS, 0000 0010 dddd rrrr */
        var R = cpu.dataView.getInt8(((opcode & 0xf0) >> 4) + 16) * cpu.dataView.getInt8((opcode & 0xf) + 16);
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = (cpu.data[95] & 0xfc) | (0xffff & R ? 0 : 2) | (0x8000 & R ? 1 : 0);
        cpu.cycles++;
    }
    else if ((opcode & 0xff88) === 0x300) {
        /* MULSU, 0000 0011 0ddd 0rrr */
        var R = cpu.dataView.getInt8(((opcode & 0x70) >> 4) + 16) * cpu.data[(opcode & 7) + 16];
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = (cpu.data[95] & 0xfc) | (0xffff & R ? 0 : 2) | (0x8000 & R ? 1 : 0);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x9401) {
        /* NEG, 1001 010d dddd 0001 */
        var d = (opcode & 0x1f0) >> 4;
        var value = cpu.data[d];
        var R = 0 - value;
        cpu.data[d] = R;
        let sreg = cpu.data[95] & 0xc0;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= 128 === R ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= R ? 1 : 0;
        sreg |= 1 & (R | value) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if (opcode === 0) {
        /* NOP, 0000 0000 0000 0000 */
        /* NOP */
    }
    else if ((opcode & 0xfc00) === 0x2800) {
        /* OR, 0010 10rd dddd rrrr */
        var R = cpu.data[(opcode & 0x1f0) >> 4] | cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xe1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xf000) === 0x6000) {
        /* SBR, 0110 KKKK dddd KKKK */
        var R = cpu.data[((opcode & 0xf0) >> 4) + 16] | ((opcode & 0xf) | ((opcode & 0xf00) >> 4));
        cpu.data[((opcode & 0xf0) >> 4) + 16] = R;
        let sreg = cpu.data[95] & 0xe1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xf800) === 0xb800) {
        /* OUT, 1011 1AAr rrrr AAAA */
        cpu.writeData(((opcode & 0xf) | ((opcode & 0x600) >> 5)) + 32, cpu.data[(opcode & 0x1f0) >> 4]);
    }
    else if ((opcode & 0xfe0f) === 0x900f) {
        /* POP, 1001 000d dddd 1111 */
        var value = cpu.dataView.getUint16(93, true) + 1;
        cpu.dataView.setUint16(93, value, true);
        cpu.data[(opcode & 0x1f0) >> 4] = cpu.data[value];
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x920f) {
        /* PUSH, 1001 001d dddd 1111 */
        var value = cpu.dataView.getUint16(93, true);
        cpu.data[value] = cpu.data[(opcode & 0x1f0) >> 4];
        cpu.dataView.setUint16(93, value - 1, true);
        cpu.cycles++;
    }
    else if ((opcode & 0xf000) === 0xd000) {
        /* RCALL, 1101 kkkk kkkk kkkk */
        var k = (opcode & 0x7ff) - (opcode & 0x800 ? 0x800 : 0);
        var retAddr = cpu.pc + 1;
        var sp = cpu.dataView.getUint16(93, true);
        var { pc22Bits } = cpu;
        cpu.data[sp] = 255 & retAddr;
        cpu.data[sp - 1] = (retAddr >> 8) & 255;
        if (pc22Bits) {
            cpu.data[sp - 2] = (retAddr >> 16) & 255;
        }
        cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
        cpu.pc += k;
        cpu.cycles += pc22Bits ? 3 : 2;
    }
    else if (opcode === 0x9508) {
        /* RET, 1001 0101 0000 1000 */
        var { pc22Bits } = cpu;
        var i = cpu.dataView.getUint16(93, true) + (pc22Bits ? 3 : 2);
        cpu.dataView.setUint16(93, i, true);
        cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1;
        if (pc22Bits) {
            cpu.pc |= cpu.data[i - 2] << 16;
        }
        cpu.cycles += pc22Bits ? 4 : 3;
    }
    else if (opcode === 0x9518) {
        /* RETI, 1001 0101 0001 1000 */
        var { pc22Bits } = cpu;
        var i = cpu.dataView.getUint16(93, true) + (pc22Bits ? 3 : 2);
        cpu.dataView.setUint16(93, i, true);
        cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1;
        if (pc22Bits) {
            cpu.pc |= cpu.data[i - 2] << 16;
        }
        cpu.cycles += pc22Bits ? 4 : 3;
        cpu.data[95] |= 0x80; // Enable interrupts
    }
    else if ((opcode & 0xf000) === 0xc000) {
        /* RJMP, 1100 kkkk kkkk kkkk */
        cpu.pc = cpu.pc + ((opcode & 0x7ff) - (opcode & 0x800 ? 0x800 : 0));
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x9407) {
        /* ROR, 1001 010d dddd 0111 */
        var d = cpu.data[(opcode & 0x1f0) >> 4];
        var r = (d >>> 1) | ((cpu.data[95] & 1) << 7);
        cpu.data[(opcode & 0x1f0) >> 4] = r;
        let sreg = cpu.data[95] & 0xe0;
        sreg |= r ? 0 : 2;
        sreg |= 128 & r ? 4 : 0;
        sreg |= 1 & d ? 1 : 0;
        sreg |= ((sreg >> 2) & 1) ^ (sreg & 1) ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfc00) === 0x800) {
        /* SBC, 0000 10rd dddd rrrr */
        var val1 = cpu.data[(opcode & 0x1f0) >> 4];
        var val2 = cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        let sreg = cpu.data[95];
        var R = val1 - val2 - (sreg & 1);
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        sreg = (sreg & 0xc0) | (!R && (sreg >> 1) & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0);
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= 1 & ((~val1 & val2) | (val2 & R) | (R & ~val1)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xf000) === 0x4000) {
        /* SBCI, 0100 KKKK dddd KKKK */
        var val1 = cpu.data[((opcode & 0xf0) >> 4) + 16];
        var val2 = (opcode & 0xf) | ((opcode & 0xf00) >> 4);
        let sreg = cpu.data[95];
        var R = val1 - val2 - (sreg & 1);
        cpu.data[((opcode & 0xf0) >> 4) + 16] = R;
        sreg = (sreg & 0xc0) | (!R && (sreg >> 1) & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0);
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= 1 & ((~val1 & val2) | (val2 & R) | (R & ~val1)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xff00) === 0x9a00) {
        /* SBI, 1001 1010 AAAA Abbb */
        var target = ((opcode & 0xf8) >> 3) + 32;
        cpu.writeData(target, cpu.readData(target) | (1 << (opcode & 7)));
        cpu.cycles++;
    }
    else if ((opcode & 0xff00) === 0x9900) {
        /* SBIC, 1001 1001 AAAA Abbb */
        var value = cpu.readData(((opcode & 0xf8) >> 3) + 32);
        if (!(value & (1 << (opcode & 7)))) {
            var nextOpcode = cpu.progMem[cpu.pc + 1];
            var skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
        }
    }
    else if ((opcode & 0xff00) === 0x9b00) {
        /* SBIS, 1001 1011 AAAA Abbb */
        var value = cpu.readData(((opcode & 0xf8) >> 3) + 32);
        if (value & (1 << (opcode & 7))) {
            var nextOpcode = cpu.progMem[cpu.pc + 1];
            var skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
        }
    }
    else if ((opcode & 0xff00) === 0x9700) {
        /* SBIW, 1001 0111 KKdd KKKK */
        var i = 2 * ((opcode & 0x30) >> 4) + 24;
        var a = cpu.dataView.getUint16(i, true);
        var l = (opcode & 0xf) | ((opcode & 0xc0) >> 2);
        var R = a - l;
        cpu.dataView.setUint16(i, R, true);
        let sreg = cpu.data[95] & 0xc0;
        sreg |= R ? 0 : 2;
        sreg |= 0x8000 & R ? 4 : 0;
        sreg |= a & ~R & 0x8000 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= l > a ? 1 : 0;
        sreg |= 1 & ((~a & l) | (l & R) | (R & ~a)) ? 0x20 : 0;
        cpu.data[95] = sreg;
        cpu.cycles++;
    }
    else if ((opcode & 0xfe08) === 0xfc00) {
        /* SBRC, 1111 110r rrrr 0bbb */
        if (!(cpu.data[(opcode & 0x1f0) >> 4] & (1 << (opcode & 7)))) {
            var nextOpcode = cpu.progMem[cpu.pc + 1];
            var skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
        }
    }
    else if ((opcode & 0xfe08) === 0xfe00) {
        /* SBRS, 1111 111r rrrr 0bbb */
        if (cpu.data[(opcode & 0x1f0) >> 4] & (1 << (opcode & 7))) {
            var nextOpcode = cpu.progMem[cpu.pc + 1];
            var skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
        }
    }
    else if (opcode === 0x9588) {
        /* SLEEP, 1001 0101 1000 1000 */
        /* not implemented */
    }
    else if (opcode === 0x95e8) {
        /* SPM, 1001 0101 1110 1000 */
        /* not implemented */
    }
    else if (opcode === 0x95f8) {
        /* SPM(INC), 1001 0101 1111 1000 */
        /* not implemented */
    }
    else if ((opcode & 0xfe0f) === 0x9200) {
        /* STS, 1001 001d dddd 0000 kkkk kkkk kkkk kkkk */
        var value = cpu.data[(opcode & 0x1f0) >> 4];
        var addr = cpu.progMem[cpu.pc + 1];
        cpu.writeData(addr, value);
        cpu.pc++;
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x920c) {
        /* STX, 1001 001r rrrr 1100 */
        cpu.writeData(cpu.dataView.getUint16(26, true), cpu.data[(opcode & 0x1f0) >> 4]);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x920d) {
        /* STX(INC), 1001 001r rrrr 1101 */
        var x = cpu.dataView.getUint16(26, true);
        cpu.writeData(x, cpu.data[(opcode & 0x1f0) >> 4]);
        cpu.dataView.setUint16(26, x + 1, true);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x920e) {
        /* STX(DEC), 1001 001r rrrr 1110 */
        var i = cpu.data[(opcode & 0x1f0) >> 4];
        var x = cpu.dataView.getUint16(26, true) - 1;
        cpu.dataView.setUint16(26, x, true);
        cpu.writeData(x, i);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x8208) {
        /* STY, 1000 001r rrrr 1000 */
        cpu.writeData(cpu.dataView.getUint16(28, true), cpu.data[(opcode & 0x1f0) >> 4]);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x9209) {
        /* STY(INC), 1001 001r rrrr 1001 */
        var i = cpu.data[(opcode & 0x1f0) >> 4];
        var y = cpu.dataView.getUint16(28, true);
        cpu.writeData(y, i);
        cpu.dataView.setUint16(28, y + 1, true);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x920a) {
        /* STY(DEC), 1001 001r rrrr 1010 */
        var i = cpu.data[(opcode & 0x1f0) >> 4];
        var y = cpu.dataView.getUint16(28, true) - 1;
        cpu.dataView.setUint16(28, y, true);
        cpu.writeData(y, i);
        cpu.cycles++;
    }
    else if ((opcode & 0xd208) === 0x8208 &&
        (opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)) {
        /* STDY, 10q0 qq1r rrrr 1qqq */
        cpu.writeData(cpu.dataView.getUint16(28, true) +
            ((opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)), cpu.data[(opcode & 0x1f0) >> 4]);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x8200) {
        /* STZ, 1000 001r rrrr 0000 */
        cpu.writeData(cpu.dataView.getUint16(30, true), cpu.data[(opcode & 0x1f0) >> 4]);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x9201) {
        /* STZ(INC), 1001 001r rrrr 0001 */
        var z = cpu.dataView.getUint16(30, true);
        cpu.writeData(z, cpu.data[(opcode & 0x1f0) >> 4]);
        cpu.dataView.setUint16(30, z + 1, true);
        cpu.cycles++;
    }
    else if ((opcode & 0xfe0f) === 0x9202) {
        /* STZ(DEC), 1001 001r rrrr 0010 */
        var i = cpu.data[(opcode & 0x1f0) >> 4];
        var z = cpu.dataView.getUint16(30, true) - 1;
        cpu.dataView.setUint16(30, z, true);
        cpu.writeData(z, i);
        cpu.cycles++;
    }
    else if ((opcode & 0xd208) === 0x8200 &&
        (opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)) {
        /* STDZ, 10q0 qq1r rrrr 0qqq */
        cpu.writeData(cpu.dataView.getUint16(30, true) +
            ((opcode & 7) | ((opcode & 0xc00) >> 7) | ((opcode & 0x2000) >> 8)), cpu.data[(opcode & 0x1f0) >> 4]);
        cpu.cycles++;
    }
    else if ((opcode & 0xfc00) === 0x1800) {
        /* SUB, 0001 10rd dddd rrrr */
        var val1 = cpu.data[(opcode & 0x1f0) >> 4];
        var val2 = cpu.data[(opcode & 0xf) | ((opcode & 0x200) >> 5)];
        var R = val1 - val2;
        cpu.data[(opcode & 0x1f0) >> 4] = R;
        let sreg = cpu.data[95] & 0xc0;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= val2 > val1 ? 1 : 0;
        sreg |= 1 & ((~val1 & val2) | (val2 & R) | (R & ~val1)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xf000) === 0x5000) {
        /* SUBI, 0101 KKKK dddd KKKK */
        var val1 = cpu.data[((opcode & 0xf0) >> 4) + 16];
        var val2 = (opcode & 0xf) | ((opcode & 0xf00) >> 4);
        var R = val1 - val2;
        cpu.data[((opcode & 0xf0) >> 4) + 16] = R;
        let sreg = cpu.data[95] & 0xc0;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= ((sreg >> 2) & 1) ^ ((sreg >> 3) & 1) ? 0x10 : 0;
        sreg |= val2 > val1 ? 1 : 0;
        sreg |= 1 & ((~val1 & val2) | (val2 & R) | (R & ~val1)) ? 0x20 : 0;
        cpu.data[95] = sreg;
    }
    else if ((opcode & 0xfe0f) === 0x9402) {
        /* SWAP, 1001 010d dddd 0010 */
        var d = (opcode & 0x1f0) >> 4;
        var i = cpu.data[d];
        cpu.data[d] = ((15 & i) << 4) | ((240 & i) >>> 4);
    }
    else if (opcode === 0x95a8) {
        /* WDR, 1001 0101 1010 1000 */
        /* not implemented */
    }
    else if ((opcode & 0xfe0f) === 0x9204) {
        /* XCH, 1001 001r rrrr 0100 */
        var r = (opcode & 0x1f0) >> 4;
        var val1 = cpu.data[r];
        var val2 = cpu.data[cpu.dataView.getUint16(30, true)];
        cpu.data[cpu.dataView.getUint16(30, true)] = val1;
        cpu.data[r] = val2;
    }
    cpu.pc = (cpu.pc + 1) % cpu.progMem.length;
    cpu.cycles++;
}
exports.avrInstruction = avrInstruction;

},{}],5:[function(require,module,exports){
"use strict";
/**
 * AVR-8 Interrupt Handling
 * Part of AVR8js
 * Reference: http://ww1.microchip.com/downloads/en/devicedoc/atmel-0856-avr-instruction-set-manual.pdf
 *
 * Copyright (C) 2019, Uri Shaked
 */
Object.defineProperty(exports, "__esModule", { value: true });
function avrInterrupt(cpu, addr) {
    var sp = cpu.dataView.getUint16(93, true);
    cpu.data[sp] = cpu.pc & 0xff;
    cpu.data[sp - 1] = (cpu.pc >> 8) & 0xff;
    cpu.dataView.setUint16(93, sp - 2, true);
    cpu.data[95] &= 0x7f; // clear global interrupt flag
    cpu.cycles += 2;
    cpu.pc = addr;
}
exports.avrInterrupt = avrInterrupt;

},{}],6:[function(require,module,exports){
"use strict";
/**
 * AVR8js
 *
 * Copyright (C) 2019, 2020, Uri Shaked
 */
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
var cpu_1 = require("./cpu/cpu");
exports.CPU = cpu_1.CPU;
var instruction_1 = require("./cpu/instruction");
exports.avrInstruction = instruction_1.avrInstruction;
var interrupt_1 = require("./cpu/interrupt");
exports.avrInterrupt = interrupt_1.avrInterrupt;
var timer_1 = require("./peripherals/timer");
exports.AVRTimer = timer_1.AVRTimer;
exports.timer0Config = timer_1.timer0Config;
exports.timer1Config = timer_1.timer1Config;
exports.timer2Config = timer_1.timer2Config;
var gpio_1 = require("./peripherals/gpio");
exports.AVRIOPort = gpio_1.AVRIOPort;
exports.portAConfig = gpio_1.portAConfig;
exports.portBConfig = gpio_1.portBConfig;
exports.portCConfig = gpio_1.portCConfig;
exports.portDConfig = gpio_1.portDConfig;
exports.portEConfig = gpio_1.portEConfig;
exports.portFConfig = gpio_1.portFConfig;
exports.portGConfig = gpio_1.portGConfig;
exports.portHConfig = gpio_1.portHConfig;
exports.portJConfig = gpio_1.portJConfig;
exports.portKConfig = gpio_1.portKConfig;
exports.portLConfig = gpio_1.portLConfig;
exports.PinState = gpio_1.PinState;
var usart_1 = require("./peripherals/usart");
exports.AVRUSART = usart_1.AVRUSART;
exports.usart0Config = usart_1.usart0Config;
__export(require("./peripherals/twi"));

},{"./cpu/cpu":3,"./cpu/instruction":4,"./cpu/interrupt":5,"./peripherals/gpio":7,"./peripherals/timer":8,"./peripherals/twi":9,"./peripherals/usart":10}],7:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portAConfig = {
    PIN: 0x20,
    DDR: 0x21,
    PORT: 0x22,
};
exports.portBConfig = {
    PIN: 0x23,
    DDR: 0x24,
    PORT: 0x25,
};
exports.portCConfig = {
    PIN: 0x26,
    DDR: 0x27,
    PORT: 0x28,
};
exports.portDConfig = {
    PIN: 0x29,
    DDR: 0x2a,
    PORT: 0x2b,
};
exports.portEConfig = {
    PIN: 0x2c,
    DDR: 0x2d,
    PORT: 0x2e,
};
exports.portFConfig = {
    PIN: 0x2f,
    DDR: 0x30,
    PORT: 0x31,
};
exports.portGConfig = {
    PIN: 0x32,
    DDR: 0x33,
    PORT: 0x34,
};
exports.portHConfig = {
    PIN: 0x100,
    DDR: 0x101,
    PORT: 0x102,
};
exports.portJConfig = {
    PIN: 0x103,
    DDR: 0x104,
    PORT: 0x105,
};
exports.portKConfig = {
    PIN: 0x106,
    DDR: 0x107,
    PORT: 0x108,
};
exports.portLConfig = {
    PIN: 0x109,
    DDR: 0x10a,
    PORT: 0x10b,
};
var PinState;
(function (PinState) {
    PinState[PinState["Low"] = 0] = "Low";
    PinState[PinState["High"] = 1] = "High";
    PinState[PinState["Input"] = 2] = "Input";
    PinState[PinState["InputPullUp"] = 3] = "InputPullUp";
})(PinState = exports.PinState || (exports.PinState = {}));
/* This mechanism allows timers to override specific GPIO pins */
var PinOverrideMode;
(function (PinOverrideMode) {
    PinOverrideMode[PinOverrideMode["None"] = 0] = "None";
    PinOverrideMode[PinOverrideMode["Enable"] = 1] = "Enable";
    PinOverrideMode[PinOverrideMode["Set"] = 2] = "Set";
    PinOverrideMode[PinOverrideMode["Clear"] = 3] = "Clear";
    PinOverrideMode[PinOverrideMode["Toggle"] = 4] = "Toggle";
})(PinOverrideMode = exports.PinOverrideMode || (exports.PinOverrideMode = {}));
class AVRIOPort {
    varructor(cpu, portConfig) {
        this.cpu = cpu;
        this.portConfig = portConfig;
        this.listeners = [];
        this.pinValue = 0;
        this.overrideMask = 0xff;
        this.lastValue = 0;
        this.lastDdr = 0;
        cpu.writeHooks[portConfig.DDR] = (value) => {
            var portValue = cpu.data[portConfig.PORT];
            cpu.data[portConfig.DDR] = value;
            this.updatePinRegister(portValue, value);
            this.writeGpio(portValue, value);
            return true;
        };
        cpu.writeHooks[portConfig.PORT] = (value) => {
            var ddrMask = cpu.data[portConfig.DDR];
            cpu.data[portConfig.PORT] = value;
            this.updatePinRegister(value, ddrMask);
            this.writeGpio(value, ddrMask);
            return true;
        };
        cpu.writeHooks[portConfig.PIN] = (value) => {
            // Writing to 1 PIN toggles PORT bits
            var oldPortValue = cpu.data[portConfig.PORT];
            var ddrMask = cpu.data[portConfig.DDR];
            var portValue = oldPortValue ^ value;
            cpu.data[portConfig.PORT] = portValue;
            cpu.data[portConfig.PIN] = (cpu.data[portConfig.PIN] & ~ddrMask) | (portValue & ddrMask);
            this.writeGpio(portValue, ddrMask);
            return true;
        };
        // The following hook is used by the timer compare output to override GPIO pins:
        cpu.gpioTimerHooks[portConfig.PORT] = (pin, mode) => {
            var pinMask = 1 << pin;
            if (mode == PinOverrideMode.None) {
                this.overrideMask |= pinMask;
            }
            else {
                this.overrideMask &= ~pinMask;
                switch (mode) {
                    case PinOverrideMode.Enable:
                        this.overrideValue &= ~pinMask;
                        this.overrideValue |= cpu.data[portConfig.PORT] & pinMask;
                        break;
                    case PinOverrideMode.Set:
                        this.overrideValue |= pinMask;
                        break;
                    case PinOverrideMode.Clear:
                        this.overrideValue &= ~pinMask;
                        break;
                    case PinOverrideMode.Toggle:
                        this.overrideValue ^= pinMask;
                        break;
                }
            }
            this.writeGpio(cpu.data[portConfig.PORT], cpu.data[portConfig.DDR]);
        };
    }
    addListener(listener) {
        this.listeners.push(listener);
    }
    removeListener(listener) {
        this.listeners = this.listeners.filter((l) => l !== listener);
    }
    /**
     * Get the state of a given GPIO pin
     *
     * @param index Pin index to return from 0 to 7
     * @returns PinState.Low or PinState.High if the pin is set to output, PinState.Input if the pin is set
     *   to input, and PinState.InputPullUp if the pin is set to input and the internal pull-up resistor has
     *   been enabled.
     */
    pinState(index) {
        var ddr = this.cpu.data[this.portConfig.DDR];
        var port = this.cpu.data[this.portConfig.PORT];
        var bitMask = 1 << index;
        if (ddr & bitMask) {
            return this.lastValue & bitMask ? PinState.High : PinState.Low;
        }
        else {
            return port & bitMask ? PinState.InputPullUp : PinState.Input;
        }
    }
    /**
     * Sets the input value for the given pin. This is the value that
     * will be returned when reading from the PIN register.
     */
    setPin(index, value) {
        var bitMask = 1 << index;
        this.pinValue &= ~bitMask;
        if (value) {
            this.pinValue |= bitMask;
        }
        this.updatePinRegister(this.cpu.data[this.portConfig.PORT], this.cpu.data[this.portConfig.DDR]);
    }
    updatePinRegister(port, ddr) {
        this.cpu.data[this.portConfig.PIN] = (this.pinValue & ~ddr) | (port & ddr);
    }
    writeGpio(value, ddr) {
        var newValue = ((value & this.overrideMask) | this.overrideValue) & ddr;
        var prevValue = this.lastValue;
        if (newValue !== prevValue || ddr !== this.lastDdr) {
            this.lastValue = newValue;
            this.lastDdr = ddr;
            for (var listener of this.listeners) {
                listener(newValue, prevValue);
            }
        }
    }
}
exports.AVRIOPort = AVRIOPort;

},{}],8:[function(require,module,exports){
"use strict";
/**
 * AVR-8 Timers
 * Part of AVR8js
 * Reference: http://ww1.microchip.com/downloads/en/DeviceDoc/ATmega48A-PA-88A-PA-168A-PA-328-P-DS-DS40002061A.pdf
 *
 * Copyright (C) 2019, 2020, Uri Shaked
 */
Object.defineProperty(exports, "__esModule", { value: true });
var interrupt_1 = require("../cpu/interrupt");
var gpio_1 = require("./gpio");
var timer01Dividers = {
    0: 0,
    1: 1,
    2: 8,
    3: 64,
    4: 256,
    5: 1024,
    6: 0,
    7: 0,
};
var TOV = 1;
var OCFA = 2;
var OCFB = 4;
var TOIE = 1;
var OCIEA = 2;
var OCIEB = 4;
exports.timer0Config = {
    bits: 8,
    captureInterrupt: 0,
    compAInterrupt: 0x1c,
    compBInterrupt: 0x1e,
    ovfInterrupt: 0x20,
    TIFR: 0x35,
    OCRA: 0x47,
    OCRB: 0x48,
    ICR: 0,
    TCNT: 0x46,
    TCCRA: 0x44,
    TCCRB: 0x45,
    TCCRC: 0,
    TIMSK: 0x6e,
    dividers: timer01Dividers,
    compPortA: gpio_1.portDConfig.PORT,
    compPinA: 6,
    compPortB: gpio_1.portDConfig.PORT,
    compPinB: 5,
};
exports.timer1Config = {
    bits: 16,
    captureInterrupt: 0x14,
    compAInterrupt: 0x16,
    compBInterrupt: 0x18,
    ovfInterrupt: 0x1a,
    TIFR: 0x36,
    OCRA: 0x88,
    OCRB: 0x8a,
    ICR: 0x86,
    TCNT: 0x84,
    TCCRA: 0x80,
    TCCRB: 0x81,
    TCCRC: 0x82,
    TIMSK: 0x6f,
    dividers: timer01Dividers,
    compPortA: gpio_1.portBConfig.PORT,
    compPinA: 1,
    compPortB: gpio_1.portBConfig.PORT,
    compPinB: 2,
};
exports.timer2Config = {
    bits: 8,
    captureInterrupt: 0,
    compAInterrupt: 0x0e,
    compBInterrupt: 0x10,
    ovfInterrupt: 0x12,
    TIFR: 0x37,
    OCRA: 0xb3,
    OCRB: 0xb4,
    ICR: 0,
    TCNT: 0xb2,
    TCCRA: 0xb0,
    TCCRB: 0xb1,
    TCCRC: 0,
    TIMSK: 0x70,
    dividers: {
        0: 0,
        1: 1,
        2: 8,
        3: 32,
        4: 64,
        5: 128,
        6: 256,
        7: 1024,
    },
    compPortA: gpio_1.portBConfig.PORT,
    compPinA: 3,
    compPortB: gpio_1.portDConfig.PORT,
    compPinB: 3,
};
/* All the following types and varants are related to WGM (Waveform Generation Mode) bits: */
var TimerMode;
(function (TimerMode) {
    TimerMode[TimerMode["Normal"] = 0] = "Normal";
    TimerMode[TimerMode["PWMPhaseCorrect"] = 1] = "PWMPhaseCorrect";
    TimerMode[TimerMode["CTC"] = 2] = "CTC";
    TimerMode[TimerMode["FastPWM"] = 3] = "FastPWM";
    TimerMode[TimerMode["PWMPhaseFrequencyCorrect"] = 4] = "PWMPhaseFrequencyCorrect";
    TimerMode[TimerMode["Reserved"] = 5] = "Reserved";
})(TimerMode || (TimerMode = {}));
var TOVUpdateMode;
(function (TOVUpdateMode) {
    TOVUpdateMode[TOVUpdateMode["Max"] = 0] = "Max";
    TOVUpdateMode[TOVUpdateMode["Top"] = 1] = "Top";
    TOVUpdateMode[TOVUpdateMode["Bottom"] = 2] = "Bottom";
})(TOVUpdateMode || (TOVUpdateMode = {}));
var OCRUpdateMode;
(function (OCRUpdateMode) {
    OCRUpdateMode[OCRUpdateMode["Immediate"] = 0] = "Immediate";
    OCRUpdateMode[OCRUpdateMode["Top"] = 1] = "Top";
    OCRUpdateMode[OCRUpdateMode["Bottom"] = 2] = "Bottom";
})(OCRUpdateMode || (OCRUpdateMode = {}));
var TopOCRA = 1;
var TopICR = 2;
var wgmModes8Bit = [
    /*0*/ [TimerMode.Normal, 0xff, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*1*/ [TimerMode.PWMPhaseCorrect, 0xff, OCRUpdateMode.Top, TOVUpdateMode.Bottom],
    /*2*/ [TimerMode.CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*3*/ [TimerMode.FastPWM, 0xff, OCRUpdateMode.Bottom, TOVUpdateMode.Max],
    /*4*/ [TimerMode.Reserved, 0xff, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*5*/ [TimerMode.PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom],
    /*6*/ [TimerMode.Reserved, 0xff, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*7*/ [TimerMode.FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top],
];
// Table 16-4 in the datasheet
var wgmModes16Bit = [
    /*0 */ [TimerMode.Normal, 0xffff, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*1 */ [TimerMode.PWMPhaseCorrect, 0x00ff, OCRUpdateMode.Top, TOVUpdateMode.Bottom],
    /*2 */ [TimerMode.PWMPhaseCorrect, 0x01ff, OCRUpdateMode.Top, TOVUpdateMode.Bottom],
    /*3 */ [TimerMode.PWMPhaseCorrect, 0x03ff, OCRUpdateMode.Top, TOVUpdateMode.Bottom],
    /*4 */ [TimerMode.CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*5 */ [TimerMode.FastPWM, 0x00ff, OCRUpdateMode.Bottom, TOVUpdateMode.Top],
    /*6 */ [TimerMode.FastPWM, 0x01ff, OCRUpdateMode.Bottom, TOVUpdateMode.Top],
    /*7 */ [TimerMode.FastPWM, 0x03ff, OCRUpdateMode.Bottom, TOVUpdateMode.Top],
    /*8 */ [TimerMode.PWMPhaseFrequencyCorrect, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom],
    /*9 */ [TimerMode.PWMPhaseFrequencyCorrect, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom],
    /*10*/ [TimerMode.PWMPhaseCorrect, TopICR, OCRUpdateMode.Top, TOVUpdateMode.Bottom],
    /*11*/ [TimerMode.PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom],
    /*12*/ [TimerMode.CTC, TopICR, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*13*/ [TimerMode.Reserved, 0xffff, OCRUpdateMode.Immediate, TOVUpdateMode.Max],
    /*14*/ [TimerMode.FastPWM, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Top],
    /*15*/ [TimerMode.FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top],
];
function compToOverride(comp) {
    switch (comp) {
        case 1:
            return gpio_1.PinOverrideMode.Toggle;
        case 2:
            return gpio_1.PinOverrideMode.Clear;
        case 3:
            return gpio_1.PinOverrideMode.Set;
        default:
            return gpio_1.PinOverrideMode.Enable;
    }
}
class AVRTimer {
    varructor(cpu, config) {
        this.cpu = cpu;
        this.config = config;
        this.lastCycle = 0;
        this.ocrA = 0;
        this.ocrB = 0;
        this.icr = 0; // only for 16-bit timers
        this.tcnt = 0;
        this.tcntUpdated = false;
        this.countingUp = true;
        // This is the temporary register used to access 16-bit registers (section 16.3 of the datasheet)
        this.highByteTemp = 0;
        this.updateWGMConfig();
        this.cpu.readHooks[config.TCNT] = (addr) => {
            this.tick();
            if (this.config.bits === 16) {
                this.cpu.data[addr + 1] = this.tcnt >> 8;
            }
            return (this.cpu.data[addr] = this.tcnt & 0xff);
        };
        this.cpu.writeHooks[config.TCNT] = (value) => {
            this.tcnt = (this.highByteTemp << 8) | value;
            this.tcntUpdated = true;
            this.timerUpdated();
        };
        this.cpu.writeHooks[config.OCRA] = (value) => {
            // TODO implement buffering when timer running in PWM mode
            this.ocrA = (this.highByteTemp << 8) | value;
        };
        this.cpu.writeHooks[config.OCRB] = (value) => {
            // TODO implement buffering when timer running in PWM mode
            this.ocrB = (this.highByteTemp << 8) | value;
        };
        this.cpu.writeHooks[config.ICR] = (value) => {
            this.icr = (this.highByteTemp << 8) | value;
        };
        if (this.config.bits === 16) {
            var updateTempRegister = (value) => {
                this.highByteTemp = value;
            };
            this.cpu.writeHooks[config.TCNT + 1] = updateTempRegister;
            this.cpu.writeHooks[config.OCRA + 1] = updateTempRegister;
            this.cpu.writeHooks[config.OCRB + 1] = updateTempRegister;
            this.cpu.writeHooks[config.ICR + 1] = updateTempRegister;
        }
        cpu.writeHooks[config.TCCRA] = (value) => {
            this.cpu.data[config.TCCRA] = value;
            this.compA = ((value >> 6) & 0x3);
            this.updateCompA(this.compA ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
            this.compB = ((value >> 4) & 0x3);
            this.updateCompB(this.compB ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
            this.updateWGMConfig();
            return true;
        };
        cpu.writeHooks[config.TCCRB] = (value) => {
            this.cpu.data[config.TCCRB] = value;
            this.updateWGMConfig();
            return true;
        };
    }
    reset() {
        this.lastCycle = 0;
        this.ocrA = 0;
        this.ocrB = 0;
    }
    get TIFR() {
        return this.cpu.data[this.config.TIFR];
    }
    set TIFR(value) {
        this.cpu.data[this.config.TIFR] = value;
    }
    get TCCRA() {
        return this.cpu.data[this.config.TCCRA];
    }
    get TCCRB() {
        return this.cpu.data[this.config.TCCRB];
    }
    get TIMSK() {
        return this.cpu.data[this.config.TIMSK];
    }
    get CS() {
        return (this.TCCRB & 0x7);
    }
    get WGM() {
        var mask = this.config.bits === 16 ? 0x18 : 0x8;
        return ((this.TCCRB & mask) >> 1) | (this.TCCRA & 0x3);
    }
    get TOP() {
        switch (this.topValue) {
            case TopOCRA:
                return this.ocrA;
            case TopICR:
                return this.icr;
            default:
                return this.topValue;
        }
    }
    updateWGMConfig() {
        var wgmModes = this.config.bits === 16 ? wgmModes16Bit : wgmModes8Bit;
        var [timerMode, topValue] = wgmModes[this.WGM];
        this.timerMode = timerMode;
        this.topValue = topValue;
    }
    tick() {
        var divider = this.config.dividers[this.CS];
        var delta = this.cpu.cycles - this.lastCycle;
        if (divider && delta >= divider) {
            var counterDelta = Math.floor(delta / divider);
            this.lastCycle += counterDelta * divider;
            var val = this.tcnt;
            var { timerMode } = this;
            var phasePwm = timerMode === TimerMode.PWMPhaseCorrect || timerMode === TimerMode.PWMPhaseFrequencyCorrect;
            var newVal = phasePwm
                ? this.phasePwmCount(val, counterDelta)
                : (val + counterDelta) % (this.TOP + 1);
            // A CPU write overrides (has priority over) all counter clear or count operations.
            if (!this.tcntUpdated) {
                this.tcnt = newVal;
                this.timerUpdated();
            }
            if ((timerMode === TimerMode.Normal || timerMode === TimerMode.FastPWM) && val > newVal) {
                this.TIFR |= TOV;
            }
        }
        this.tcntUpdated = false;
        if (this.cpu.interruptsEnabled) {
            var { TIFR, TIMSK } = this;
            if (TIFR & TOV && TIMSK & TOIE) {
                interrupt_1.avrInterrupt(this.cpu, this.config.ovfInterrupt);
                this.TIFR &= ~TOV;
            }
            if (TIFR & OCFA && TIMSK & OCIEA) {
                interrupt_1.avrInterrupt(this.cpu, this.config.compAInterrupt);
                this.TIFR &= ~OCFA;
            }
            if (TIFR & OCFB && TIMSK & OCIEB) {
                interrupt_1.avrInterrupt(this.cpu, this.config.compBInterrupt);
                this.TIFR &= ~OCFB;
            }
        }
    }
    phasePwmCount(value, delta) {
        while (delta > 0) {
            if (this.countingUp) {
                value++;
                if (value === this.TOP && !this.tcntUpdated) {
                    this.countingUp = false;
                }
            }
            else {
                value--;
                if (!value && !this.tcntUpdated) {
                    this.countingUp = true;
                    this.TIFR |= TOV;
                }
            }
            delta--;
        }
        return value;
    }
    timerUpdated() {
        var value = this.tcnt;
        if (this.ocrA && value === this.ocrA) {
            this.TIFR |= OCFA;
            if (this.timerMode === TimerMode.CTC) {
                // Clear Timer on Compare Match (CTC) Mode
                this.tcnt = 0;
                this.TIFR |= TOV;
            }
            if (this.compA) {
                this.updateCompPin(this.compA, 'A');
            }
        }
        if (this.ocrB && value === this.ocrB) {
            this.TIFR |= OCFB;
            if (this.compB) {
                this.updateCompPin(this.compB, 'B');
            }
        }
    }
    updateCompPin(compValue, pinName) {
        let newValue = gpio_1.PinOverrideMode.None;
        var inverted = compValue === 3;
        var isSet = this.countingUp === inverted;
        switch (this.timerMode) {
            case TimerMode.Normal:
            case TimerMode.CTC:
            case TimerMode.FastPWM:
                newValue = compToOverride(compValue);
                break;
            case TimerMode.PWMPhaseCorrect:
            case TimerMode.PWMPhaseFrequencyCorrect:
                newValue = isSet ? gpio_1.PinOverrideMode.Set : gpio_1.PinOverrideMode.Clear;
                break;
        }
        if (newValue !== gpio_1.PinOverrideMode.None) {
            if (pinName === 'A') {
                this.updateCompA(newValue);
            }
            else {
                this.updateCompB(newValue);
            }
        }
    }
    updateCompA(value) {
        var { compPortA, compPinA } = this.config;
        var hook = this.cpu.gpioTimerHooks[compPortA];
        if (hook) {
            hook(compPinA, value, compPortA);
        }
    }
    updateCompB(value) {
        var { compPortB, compPinB } = this.config;
        var hook = this.cpu.gpioTimerHooks[compPortB];
        if (hook) {
            hook(compPinB, value, compPortB);
        }
    }
}
exports.AVRTimer = AVRTimer;

},{"../cpu/interrupt":5,"./gpio":7}],9:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var interrupt_1 = require("../cpu/interrupt");
/* eslint-disable @typescript-eslint/no-unused-vars */
// Register bits:
var TWCR_TWINT = 0x80; // TWI Interrupt Flag
var TWCR_TWEA = 0x40; // TWI Enable Acknowledge Bit
var TWCR_TWSTA = 0x20; // TWI START Condition Bit
var TWCR_TWSTO = 0x10; // TWI STOP Condition Bit
var TWCR_TWWC = 0x8; //TWI Write Collision Flag
var TWCR_TWEN = 0x4; //  TWI Enable Bit
var TWCR_TWIE = 0x1; // TWI Interrupt Enable
var TWSR_TWS_MASK = 0xf8; // TWI Status
var TWSR_TWPS1 = 0x2; // TWI Prescaler Bits
var TWSR_TWPS0 = 0x1; // TWI Prescaler Bits
var TWSR_TWPS_MASK = TWSR_TWPS1 | TWSR_TWPS0; // TWI Prescaler mask
var TWAR_TWA_MASK = 0xfe; //  TWI (Slave) Address Register
var TWAR_TWGCE = 0x1; // TWI General Call Recognition Enable Bit
var STATUS_BUS_ERROR = 0x0;
var STATUS_TWI_IDLE = 0xf8;
// Master states
var STATUS_START = 0x08;
var STATUS_REPEATED_START = 0x10;
var STATUS_SLAW_ACK = 0x18;
var STATUS_SLAW_NACK = 0x20;
var STATUS_DATA_SENT_ACK = 0x28;
var STATUS_DATA_SENT_NACK = 0x30;
var STATUS_DATA_LOST_ARBITRATION = 0x38;
var STATUS_SLAR_ACK = 0x40;
var STATUS_SLAR_NACK = 0x48;
var STATUS_DATA_RECEIVED_ACK = 0x50;
var STATUS_DATA_RECEIVED_NACK = 0x58;
// TODO: add slave states
/* eslint-enable @typescript-eslint/no-unused-vars */
exports.twiConfig = {
    twiInterrupt: 0x30,
    TWBR: 0xb8,
    TWSR: 0xb9,
    TWAR: 0xba,
    TWDR: 0xbb,
    TWCR: 0xbc,
    TWAMR: 0xbd,
};
// A simple TWI Event Handler that sends a NACK for all events
class NoopTWIEventHandler {
    varructor(twi) {
        this.twi = twi;
    }
    start() {
        this.twi.completeStart();
    }
    stop() {
        this.twi.completeStop();
    }
    connectToSlave() {
        this.twi.completeConnect(false);
    }
    writeByte() {
        this.twi.completeWrite(false);
    }
    readByte() {
        this.twi.completeRead(0xff);
    }
}
exports.NoopTWIEventHandler = NoopTWIEventHandler;
class AVRTWI {
    varructor(cpu, config, freqMHz) {
        this.cpu = cpu;
        this.config = config;
        this.freqMHz = freqMHz;
        this.eventHandler = new NoopTWIEventHandler(this);
        this.nextTick = null;
        this.updateStatus(STATUS_TWI_IDLE);
        this.cpu.writeHooks[config.TWCR] = (value) => {
            var clearInt = value & TWCR_TWINT;
            if (clearInt) {
                value &= ~TWCR_TWINT;
            }
            var { status } = this;
            if (clearInt && value & TWCR_TWEN) {
                var twdrValue = this.cpu.data[this.config.TWDR];
                this.nextTick = () => {
                    if (value & TWCR_TWSTA) {
                        this.eventHandler.start(status !== STATUS_TWI_IDLE);
                    }
                    else if (value & TWCR_TWSTO) {
                        this.eventHandler.stop();
                    }
                    else if (status === STATUS_START) {
                        this.eventHandler.connectToSlave(twdrValue >> 1, twdrValue & 0x1 ? false : true);
                    }
                    else if (status === STATUS_SLAW_ACK || status === STATUS_DATA_SENT_ACK) {
                        this.eventHandler.writeByte(twdrValue);
                    }
                    else if (status === STATUS_SLAR_ACK || status === STATUS_DATA_RECEIVED_ACK) {
                        var ack = !!(value & TWCR_TWEA);
                        this.eventHandler.readByte(ack);
                    }
                };
                this.cpu.data[config.TWCR] = value;
                return true;
            }
        };
    }
    tick() {
        if (this.nextTick) {
            this.nextTick();
            this.nextTick = null;
        }
        if (this.cpu.interruptsEnabled) {
            var { TWCR, twiInterrupt } = this.config;
            if (this.cpu.data[TWCR] & TWCR_TWIE && this.cpu.data[TWCR] & TWCR_TWINT) {
                interrupt_1.avrInterrupt(this.cpu, twiInterrupt);
                this.cpu.data[TWCR] &= ~TWCR_TWINT;
            }
        }
    }
    get prescaler() {
        switch (this.cpu.data[this.config.TWSR] & TWSR_TWPS_MASK) {
            case 0:
                return 1;
            case 1:
                return 4;
            case 2:
                return 16;
            case 3:
                return 64;
        }
        // We should never get here:
        throw new Error('Invalid prescaler value!');
    }
    get sclFrequency() {
        return this.freqMHz / (16 + 2 * this.cpu.data[this.config.TWBR] * this.prescaler);
    }
    completeStart() {
        this.updateStatus(this.status === STATUS_TWI_IDLE ? STATUS_START : STATUS_REPEATED_START);
    }
    completeStop() {
        this.cpu.data[this.config.TWCR] &= ~TWCR_TWSTO;
        this.updateStatus(STATUS_TWI_IDLE);
    }
    completeConnect(ack) {
        if (this.cpu.data[this.config.TWDR] & 0x1) {
            this.updateStatus(ack ? STATUS_SLAR_ACK : STATUS_SLAR_NACK);
        }
        else {
            this.updateStatus(ack ? STATUS_SLAW_ACK : STATUS_SLAW_NACK);
        }
    }
    completeWrite(ack) {
        this.updateStatus(ack ? STATUS_DATA_SENT_ACK : STATUS_DATA_SENT_NACK);
    }
    completeRead(value) {
        var ack = !!(this.cpu.data[this.config.TWCR] & TWCR_TWEA);
        this.cpu.data[this.config.TWDR] = value;
        this.updateStatus(ack ? STATUS_DATA_RECEIVED_ACK : STATUS_DATA_RECEIVED_NACK);
    }
    get status() {
        return this.cpu.data[this.config.TWSR] & TWSR_TWS_MASK;
    }
    updateStatus(value) {
        var { TWCR, TWSR } = this.config;
        this.cpu.data[TWSR] = (this.cpu.data[TWSR] & ~TWSR_TWS_MASK) | value;
        this.cpu.data[TWCR] |= TWCR_TWINT;
    }
}
exports.AVRTWI = AVRTWI;

},{"../cpu/interrupt":5}],10:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var interrupt_1 = require("../cpu/interrupt");
exports.usart0Config = {
    rxCompleteInterrupt: 0x24,
    dataRegisterEmptyInterrupt: 0x26,
    txCompleteInterrupt: 0x28,
    UCSRA: 0xc0,
    UCSRB: 0xc1,
    UCSRC: 0xc2,
    UBRRL: 0xc4,
    UBRRH: 0xc5,
    UDR: 0xc6,
};
/* eslint-disable @typescript-eslint/no-unused-vars */
// Register bits:
var UCSRA_RXC = 0x80; // USART Receive Complete
var UCSRA_TXC = 0x40; // USART Transmit Complete
var UCSRA_UDRE = 0x20; // USART Data Register Empty
var UCSRA_FE = 0x10; // Frame Error
var UCSRA_DOR = 0x8; // Data OverRun
var UCSRA_UPE = 0x4; // USART Parity Error
var UCSRA_U2X = 0x2; // Double the USART Transmission Speed
var UCSRA_MPCM = 0x1; // Multi-processor Communication Mode
var UCSRB_RXCIE = 0x80; // RX Complete Interrupt Enable
var UCSRB_TXCIE = 0x40; // TX Complete Interrupt Enable
var UCSRB_UDRIE = 0x20; // USART Data Register Empty Interrupt Enable
var UCSRB_RXEN = 0x10; // Receiver Enable
var UCSRB_TXEN = 0x8; // Transmitter Enable
var UCSRB_UCSZ2 = 0x4; // Character Size 2
var UCSRB_RXB8 = 0x2; // Receive Data Bit 8
var UCSRB_TXB8 = 0x1; // Transmit Data Bit 8
var UCSRC_UMSEL1 = 0x80; // USART Mode Select 1
var UCSRC_UMSEL0 = 0x40; // USART Mode Select 0
var UCSRC_UPM1 = 0x20; // Parity Mode 1
var UCSRC_UPM0 = 0x10; // Parity Mode 0
var UCSRC_USBS = 0x8; // Stop Bit Select
var UCSRC_UCSZ1 = 0x4; // Character Size 1
var UCSRC_UCSZ0 = 0x2; // Character Size 0
var UCSRC_UCPOL = 0x1; // Clock Polarity
/* eslint-enable @typescript-eslint/no-unused-vars */
class AVRUSART {
    varructor(cpu, config, freqMHz) {
        this.cpu = cpu;
        this.config = config;
        this.freqMHz = freqMHz;
        this.onByteTransmit = null;
        this.onLineTransmit = null;
        this.lineBuffer = '';
        this.cpu.writeHooks[config.UCSRA] = (value) => {
            this.cpu.data[config.UCSRA] = value | UCSRA_UDRE | UCSRA_TXC;
            return true;
        };
        this.cpu.writeHooks[config.UCSRB] = (value, oldValue) => {
            if (value & UCSRB_TXEN && !(oldValue & UCSRB_TXEN)) {
                // Enabling the transmission - mark UDR as empty
                this.cpu.data[config.UCSRA] |= UCSRA_UDRE;
            }
        };
        this.cpu.writeHooks[config.UDR] = (value) => {
            if (this.onByteTransmit) {
                this.onByteTransmit(value);
            }
            if (this.onLineTransmit) {
                var ch = String.fromCharCode(value);
                if (ch === '\n') {
                    this.onLineTransmit(this.lineBuffer);
                    this.lineBuffer = '';
                }
                else {
                    this.lineBuffer += ch;
                }
            }
            this.cpu.data[config.UCSRA] |= UCSRA_UDRE | UCSRA_TXC;
        };
    }
    tick() {
        if (this.cpu.interruptsEnabled) {
            var ucsra = this.cpu.data[this.config.UCSRA];
            var ucsrb = this.cpu.data[this.config.UCSRB];
            if (ucsra & UCSRA_UDRE && ucsrb & UCSRB_UDRIE) {
                interrupt_1.avrInterrupt(this.cpu, this.config.dataRegisterEmptyInterrupt);
                this.cpu.data[this.config.UCSRA] &= ~UCSRA_UDRE;
            }
            if (ucsrb & UCSRA_TXC && ucsrb & UCSRB_TXCIE) {
                interrupt_1.avrInterrupt(this.cpu, this.config.txCompleteInterrupt);
                this.cpu.data[this.config.UCSRA] &= ~UCSRA_TXC;
            }
        }
    }
    get baudRate() {
        var UBRR = (this.cpu.data[this.config.UBRRH] << 8) | this.cpu.data[this.config.UBRRL];
        var multiplier = this.cpu.data[this.config.UCSRA] & UCSRA_U2X ? 8 : 16;
        return Math.floor(this.freqMHz / (multiplier * (1 + UBRR)));
    }
    get bitsPerChar() {
        var ucsz = ((this.cpu.data[this.config.UCSRA] & (UCSRC_UCSZ1 | UCSRC_UCSZ0)) >> 1) |
            (this.cpu.data[this.config.UCSRB] & UCSRB_UCSZ2);
        switch (ucsz) {
            case 0:
                return 5;
            case 1:
                return 6;
            case 2:
                return 7;
            case 3:
                return 8;
            default: // 4..6 are reserved
            case 7:
                return 9;
        }
    }
}
exports.AVRUSART = AVRUSART;

},{"../cpu/interrupt":5}],11:[function(require,module,exports){

},{}],12:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}],13:[function(require,module,exports){

var fs = require('fs');
// var { CPU, avrInstruction, AVRTimer, timer0Config } = require('../../dist/cjs');
var { CPU, avrInstruction, AVRTimer, timer0Config } = require('avr8js');
var { AVRRunner } = require('./AvrRunner');


// var fetch = require("node-fetch");

var url = 'https://hexi.wokwi.com';
var BLINK_CODE = `
// Green LED connected to LED_BUILTIN,
// Red LED connected to pin 12. Enjoy!

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  Serial.println("Blink");
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}`.trim();

// var program = new Uint16Array(16384);

// version to load from file
 function onlyRun() {
  try {

    let data = null;

    // browser...
    if (typeof(window) !== 'undefined') {

      console.log('Running on: browser');
      let response =  fetch('./blink.hex');
      data =  response.text();

    } else if (typeof(read) !== 'undefined') { // graaljs

      console.log('Running on: graaljs');
      data = read('./blink.hex');

    } else if (typeof(Java) !== 'undefined') { // graaljs


      console.log('Running on: Java');

      var StringClass = Java.type('java.lang.String');
      var Files = Java.type('java.nio.file.Files');
      var Paths = Java.type('java.nio.file.Paths');

      data = new StringClass(Files.readAllBytes(Paths.get("./blink.hex")));
      print(data);


    } else { // nodejs

      console.log('Running on: NodeJS');

      fs.readFile('./blink.hex', 'utf8', function(err, data) {
        if (err) {
          return console.log(err);
        }

        console.log('Program running...');
        executeProgram(data);

      })

      // console.log('response',response);
    }

    if (data) {
      console.log('Program running...');
      executeProgram(data);
    }

  } catch (err) {

    console.error('Failed: ' + err);
  } finally {}
}

 function compileAndRun() {
  try {
    var result =  buildHex(BLINK_CODE);

    if (result.hex) {
      // fs.writeFile('./blink.hex', result.hex, function (err) {
      //     if (err) return console.log(err);
      //     console.log("Done save...");
      // });  
      console.log('Program running...');
      executeProgram(result.hex);
    } else {}
  } catch (err) {

    console.error('Failed: ' + err);
  } finally {}
}

  // Set up toolbar
let runner;


function executeProgram(hex) {
  runner = new AVRRunner(hex);
  var MHZ = 16000000;

  // Hook to PORTB register
  runner.portB.addListener((value) => {
    console.log("[PIN.13]" + runner.portB.pinState(5));
  });
  runner.usart.onByteTransmit = (value) => {
    console.log("[USART]" + String.fromCharCode(value));
  };
//   var cpuPerf = new CPUPerformance(runner.cpu, MHZ);
  runner.execute((cpu) => {
    // var time = formatTime(cpu.cycles / MHZ);
    console.log("CPU", cpu.cycles / MHZ);
    // var speed = (cpuPerf.update() * 100).toFixed(0);
    // statusLabel.textContent = `Simulation time: ${time} (${speed}%)`;
  });
}

 function buildHex(source) {
    var resp =  fetch(url + '/build', {
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sketch: source }),
    });
    return ( resp.json());
  }
  


  onlyRun();
//   compileAndRun();
},{"./AvrRunner":1,"avr8js":6,"fs":11}],14:[function(require,module,exports){
// exports.MicroTaskScheduler = void 0;
var EventEmitter = require('events');

var events = new EventEmitter();

class MicroTaskScheduler {
  varructor() {
    this.messageName = 'zero-timeout-message';
    this.executionQueue = [];
    this.stopped = true;

    this.handleMessage = (event_p1, event_p2) => {
        // console.log("handleMessage : " + a + ", b : " + b);
        
      if (event_p1 === this.messageName) {
        // event.stopPropagation();
        var executeJob = this.executionQueue.shift();

        if (executeJob !== undefined) {
            
          executeJob();
        }
      }
    };
  }

    start() {
        if (this.stopped) {
            this.stopped = false;
            //   window.addEventListener('message', this.handleMessage, true);
            events.on('message', this.handleMessage);
        }
    }

  stop() {
    this.stopped = true;
    // window.removeListener('message', this.handleMessage, true);
    events.removeListener('message', this.handleMessage);
  }

  postTask(fn) {
    if (!this.stopped) {
      this.executionQueue.push(fn);
    //   window.postMessage(this.messageName, '*');
      events.emit('message',this.messageName, '*');
    }
  }

}

exports.MicroTaskScheduler = MicroTaskScheduler;
},{"events":12}]},{},[13]);
