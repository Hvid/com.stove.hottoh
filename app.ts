'use strict';

import Homey from 'homey';

module.exports = class HottohApp extends Homey.App {
  private anyStoveOnTrigger: any;

  /**
   * App initialization
   * Sets up app-level flow cards
   */
  async onInit() {
    this.log('HottoH Stove App has been initialized');

    this.anyStoveOnTrigger = this.homey.flow.getTriggerCard('any_stove_on');
    // Only run flows whose selected power state matches the change
    this.anyStoveOnTrigger.registerRunListener(async (args: any, state: any) => {
      return args.power_state === state.power_state;
    });
  }

  /**
   * Trigger the any_stove_on flow
   * Called from device.ts when a stove's on/off state changes
   */
  public async triggerAnyStoveOn(device: any, value: boolean) {
    return this.anyStoveOnTrigger.trigger(
      { name: device.getName() },
      { power_state: value ? 'on' : 'off' },
    );
  }
};
