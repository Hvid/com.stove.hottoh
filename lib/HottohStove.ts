import * as net from 'net';

const StoveCommands = {
  PARAM_ON_OFF: 0,
  PARAM_POWER_LEVEL: 2,
  PARAM_AMBIANCE_TEMPERATURE_1: 3,
  PARAM_FAN_SPEED: 6
};

const StoveRegisters = {
  INDEX_STOVE_ON: 6,
  INDEX_STATE: 8,
  INDEX_AMBIENT_T1: 9,
  INDEX_AMBIENT_T1_SET: 10,
  INDEX_SMOKE_T: 21,
  INDEX_POWER_LEVEL: 22,
  INDEX_FAN_SPEED: 23,
  INDEX_FUMES: 24
};

const StoveStateMap: { [key: string]: string } = {
  '0': 'off',
  '1': 'ignition',
  '2': 'heating',
  '3': 'modulation',
  '4': 'stopping',
  '5': 'cooling',
  '6': 'alarm',
  '7': 'out_of_fuel'
};

const crc16ccitt = (buf: Buffer) => {
  let crc = 0xFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).padStart(4, '0');
};

function buildRequest(command = 'DAT', mode = 'R', parameters = ['0']) {
  const strSocketId = '00000';
  const paramString = parameters.join(';') + ';';
  const lenParameters = paramString.length.toString(16).padStart(4, '0').toUpperCase();
  const strCmd = lenParameters + command + mode;
  const strRawData = strCmd + paramString;
  const strData = strSocketId + 'C---' + strRawData;
  const crc16 = crc16ccitt(Buffer.from(strData, 'utf8'));
  return Buffer.from('#' + strData + crc16 + '\n', 'utf8');
}

export class HottohStove {
  private host: string;
  private port: number;
  private client: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private reconnectTries = 0;
  private maxReconnectTries = 5;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tryConnect = () => {
        this.client = new net.Socket();
        this.client.setNoDelay(true);
        this.client.setTimeout(5000);
        this.client.connect(this.port, this.host, () => {
          this.reconnectTries = 0;
          resolve();
        });
        this.client.on('timeout', () => {
          this.client?.destroy();
          this.client = null;
          reject(new Error('Connection timed out'));
        });
        this.client.on('data', (data: Buffer) => {
          this.buffer = Buffer.concat([this.buffer, data]);
        });
        this.client.on('error', (err: Error) => {
          this.client?.destroy();
          this.client = null;
          if (this.reconnectTries < this.maxReconnectTries) {
            this.reconnectTries++;
            setTimeout(tryConnect, 1000 * this.reconnectTries);
          } else {
            reject(new Error('Failed to connect after retries: ' + err.message));
          }
        });
      };
      tryConnect();
    });
  }

  disconnect() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.reconnectTries = 0;
  }

  private async sendCommand(parameters: string[], mode = 'W'): Promise<string[]> {
    if (!this.client) throw new Error('Not connected');
    this.buffer = Buffer.alloc(0);
    const req = buildRequest('DAT', mode, parameters);
    this.client.write(req);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const response = this.buffer.toString('utf8');
    if (!response || !response.includes(';')) {
      throw new Error('Malformed or empty response from stove');
    }
    return response.split(';');
  }

  async turnOn(): Promise<void> {
    if (!this.client || this.client.destroyed) await this.connect();
    await this.sendCommand([
      String(StoveCommands.PARAM_ON_OFF),
      '1'
    ]);
  }

  async turnOff(): Promise<void> {
    if (!this.client || this.client.destroyed) await this.connect();
    await this.sendCommand([
      String(StoveCommands.PARAM_ON_OFF),
      '0'
    ]);
  }

  async setTargetTemperature(temp: number): Promise<void> {
    if (!this.client || this.client.destroyed) await this.connect();
    await this.sendCommand([
      String(StoveCommands.PARAM_AMBIANCE_TEMPERATURE_1),
      String(Math.round(temp * 10))
    ]);
  }

  private async readData(): Promise<string[]> {
    if (!this.client || this.client.destroyed) await this.connect();
    return this.sendCommand(['0'], 'R');
  }

  async getIsOn(): Promise<boolean> {
    const data = await this.readData();
    return data[StoveRegisters.INDEX_STOVE_ON] === '1';
  }

  async getRoomTemperature(): Promise<number> {
    const data = await this.readData();
    return parseInt(data[StoveRegisters.INDEX_AMBIENT_T1], 10) / 10;
  }

  async getTargetTemperature(): Promise<number> {
    const data = await this.readData();
    return parseInt(data[StoveRegisters.INDEX_AMBIENT_T1_SET], 10) / 10;
  }

  async getSmokeTemperature(): Promise<number> {
    const data = await this.readData();
    return parseInt(data[StoveRegisters.INDEX_SMOKE_T], 10) / 10;
  }

  async getPowerLevel(): Promise<number> {
    const data = await this.readData();
    return parseInt(data[StoveRegisters.INDEX_POWER_LEVEL], 10);
  }

  async getFanSpeed(): Promise<number> {
    const data = await this.readData();
    return parseInt(data[StoveRegisters.INDEX_FAN_SPEED], 10);
  }

  async getFumes(): Promise<number> {
    const data = await this.readData();
    return parseInt(data[StoveRegisters.INDEX_FUMES], 10);
  }

  async getStoveState(): Promise<string> {
    const data = await this.readData();
    const stateRaw = data[StoveRegisters.INDEX_STATE];
    return StoveStateMap[stateRaw] || 'unknown';
  }

  async setPowerLevel(level: number): Promise<void> {
    if (!this.client || this.client.destroyed) await this.connect();
    await this.sendCommand([
      String(StoveCommands.PARAM_POWER_LEVEL),
      String(level)
    ]);
  }

  async setFanSpeed(speed: number): Promise<void> {
    if (!this.client || this.client.destroyed) await this.connect();
    await this.sendCommand([
      String(StoveCommands.PARAM_FAN_SPEED), String(speed)
    ]);
  }
}
