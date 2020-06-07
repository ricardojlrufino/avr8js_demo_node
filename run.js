
const fs = require('fs');
// const { CPU, avrInstruction, AVRTimer, timer0Config } = require('../../dist/cjs');
const { CPU, avrInstruction, AVRTimer, timer0Config } = require('avr8js');
const { AVRRunner } = require('./AvrRunner');


// const fetch = require("node-fetch");

const url = 'https://hexi.wokwi.com';
const BLINK_CODE = `
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

// const program = new Uint16Array(16384);

// version to load from file
async function onlyRun() {
    try{
        await fs.readFile('./blink.hex', 'utf8', function (err,data) {
            console.log('error : ' + err);
            if (data) {
                console.log('Program running...');
                executeProgram(data);
              } else {
              }
        });

    } catch (err) {
  
      console.error('Failed: ' + err);
    } finally {
    }
  }

async function compileAndRun() {
    try{
      const result = await buildHex(BLINK_CODE);
      
      if (result.hex) {
        // fs.writeFile('./blink.hex', result.hex, function (err) {
        //     if (err) return console.log(err);
        //     console.log("Done save...");
        // });  
        console.log('Program running...');
        executeProgram(result.hex);
      } else {
      }
    } catch (err) {
  
      console.error('Failed: ' + err);
    } finally {
    }
  }

  // Set up toolbar
let runner;


function executeProgram(hex) {
  runner = new AVRRunner(hex);
  const MHZ = 16000000;

  // Hook to PORTB register
  runner.portB.addListener((value) => {
    console.log("[PIN.13]" + runner.portB.pinState(5));
  });
  runner.usart.onByteTransmit = (value) => {
    console.log("[USART]" + String.fromCharCode(value));
  };
//   const cpuPerf = new CPUPerformance(runner.cpu, MHZ);
  runner.execute((cpu) => {
    // const time = formatTime(cpu.cycles / MHZ);
    console.log("CPU", cpu.cycles / MHZ);
    // const speed = (cpuPerf.update() * 100).toFixed(0);
    // statusLabel.textContent = `Simulation time: ${time} (${speed}%)`;
  });
}

async function buildHex(source) {
    const resp = await fetch(url + '/build', {
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sketch: source }),
    });
    return (await resp.json());
  }
  

  onlyRun();
//   compileAndRun();