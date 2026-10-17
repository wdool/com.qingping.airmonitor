'use strict';

const { App } = require('homey');

class QingpingApp extends App {

  async onInit() {
    this.log('Qingping Air Monitor app has been initialized');
  }

}

module.exports = QingpingApp;
