exports.AVRRunner = void 0;

// const avr8js_1 = require('../../dist/cjs');
const avr8js_1 = require('avr8js');

const intelhex_1 = require("./intelhex");

// const task_scheduler_1 = require("./task-scheduler"); // ATmega328p params

const { MicroTaskScheduler } = require('./task-scheduler');

const FLASH = 0x8000;

class AVRRunner {
  constructor(hex) {
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
    const cyclesToRun = this.cpu.cycles + this.workUnitCycles;

    while (this.cpu.cycles < cyclesToRun) {
      avr8js_1.avrInstruction(this.cpu);
      this.timer0.tick();
      // this.timer1.tick();
      // this.timer2.tick();
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