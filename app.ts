'use strict';

import Homey from 'homey';

module.exports = class HottohApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('HottohApp has been initialized');
  }

}
