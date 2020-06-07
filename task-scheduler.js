// exports.MicroTaskScheduler = void 0;
const EventEmitter = require('events');

const events = new EventEmitter();

class MicroTaskScheduler {
  constructor() {
    this.messageName = 'zero-timeout-message';
    this.executionQueue = [];
    this.stopped = true;

    this.handleMessage = (event_p1, event_p2) => {
        // console.log("handleMessage : " + a + ", b : " + b);
        
      if (event_p1 === this.messageName) {
        // event.stopPropagation();
        const executeJob = this.executionQueue.shift();

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