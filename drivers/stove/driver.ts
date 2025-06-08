import Homey from 'homey';
import { HottohStove } from '../../lib/HottohStove';

module.exports = class StoveDriver extends Homey.Driver {
  async onInit() {
    this.log('StoveDriver initialized (backend, logs in Homey CLI stdout)');
  }

  async onPair(session: any) {
    session.setHandler('add_device', async (data: any) => {
      const { address, port } = data;
      if (!address || !port) {
        this.log('Pairing error: Missing address or port');
        throw new Error('IP address and port are required');
      }
      const stove = new HottohStove(address, Number(port));
      try {
        await stove.connect();
        stove.disconnect();
      } catch (err: any) {
        this.log('Pairing error: Could not connect to stove:', err && err.message ? err.message : err);
        throw new Error('Could not connect to stove: ' + (err && err.message ? err.message : String(err)));
      }
      const id = `${address}:${port}`;
      this.log('Device paired:', id);
      return {
        name: 'HottoH Stove',
        data: { id: String(id) },
        store: { host: address, port: Number(port) }
      };
    });
  }
};
// All logs from this file will appear in the Homey CLI stdout when running `homey app run`.
