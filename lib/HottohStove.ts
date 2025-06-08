// === HottohStove.ts loaded at runtime ===
console.log('=== HottohStove.ts loaded at runtime ===');
import * as net from 'net';
import { NetworkConstants, ProtocolCommands, ProtocolConstants, StoveCommands, StoveRegisters, TEMP_SCALE, StoveStateMap } from './constants';

export class HottohStove {
  private readonly host: string;
  private readonly port: number;
  private client: net.Socket | null = null;
  private dataDATR0: number[] = [];
  private infoLine: string | null = null;
  private rawDATR0: string | null = null;

  constructor(host: string, port: number = NetworkConstants.DEFAULT_PORT) {
    console.log(`[HottohStove] Constructor: host=${host}, port=${port}`);
    this.host = host;
    this.port = port;
  }

  async connect(): Promise<void> {
    if (this.client && !this.client.destroyed) return;
    this.client = new net.Socket();
    return new Promise((resolve, reject) => {
      this.client!.on('connect', () => {
        console.log(`[HottohStove] Connected to ${this.host}:${this.port}`);
        resolve();
      });
      this.client!.on('error', err => {
        console.error('[HottohStove] Socket error:', err);
        reject(err);
      });
      this.client!.on('data', data => this.parseData(data));
      this.client!.connect(this.port, this.host);
    });
  }

  disconnect(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  async fetchStoveStatus(): Promise<void> {
    if (!this.client || this.client.destroyed) await this.connect();
    await this.sendAndWaitFor('INFO', 'INFRHOTTOH');
    await this.delay(100);
    await this.sendAndWaitFor('DATR0', 'DATR0');
    await this.delay(100);
  }

  async turnOn(): Promise<void> {
    const param = StoveCommands.PARAM_ON_OFF;
    console.log('[HottohStove] PARAM_ON_OFF value:', param, 'type:', typeof param);
    // Log current state before sending ON
    console.log('[HottohStove] Current getIsOn:', this.getIsOn(), 'getState:', this.getState());
    // Send ON command once, wait for response
    await this.sendCommand([String(param), '1']);
    console.log('[HottohStove] turnOn: sent ON command as "1"');
    // Add a short delay to allow stove to process ON command
    await this.delay(1000);
    // Immediately send DATR0 read command to prompt stove to update state
    this.sendReadCommand(ProtocolCommands.DATA_COMMAND, ['0']);
    // Wait for response to be parsed
    await this.delay(500);
    // Fetch stove status (INFO and DATR0)
    await this.fetchStoveStatus();
    // If stove is now ON, set power level to 5
    if (this.getIsOn()) {
      await this.setPowerLevel(5);
      console.log('[HottohStove] turnOn: set power level to 5 after ON');
    } else {
      console.log('[HottohStove] turnOn: stove did not turn ON after command');
    }
    // Final fetch for updated state
    await this.fetchStoveStatus();
    console.log('[HottohStove] turnOn: polled for state after ON');
  }
  async turnOff(): Promise<void> {
    await this.sendCommand([String(StoveCommands.PARAM_ON_OFF), '0']);
  }
  async setTargetTemperature(temp: number): Promise<void> {
    await this.sendCommand([String(StoveCommands.PARAM_SET_TEMP), String(Math.round(temp * TEMP_SCALE))]);
  }
  async setPowerLevel(level: number): Promise<void> {
    await this.sendCommand([String(StoveCommands.PARAM_POWER_LEVEL), String(level)]);
  }
  async setFanSpeed(speed: number): Promise<void> {
    await this.sendCommand([String(StoveCommands.PARAM_FAN_SPEED), String(speed)]);
  }

  // Helper to get DATR0 register value by index constant from StoveRegisters
  private getDATR0(index: number): number | undefined {
    return this.dataDATR0[index];
  }

  // --- Minimal getters for Homey capabilities ---
  getFirmwareVersion(): string | undefined {
    if (!this.infoLine) return undefined;
    const parts = this.infoLine.split(ProtocolConstants.PARAM_SEPARATOR);
    return parts[1];
  }
  getWifiSignal(): number | undefined {
    if (!this.infoLine) return undefined;
    const parts = this.infoLine.split(ProtocolConstants.PARAM_SEPARATOR);
    return parseInt(parts[2], 10);
  }
  getManufacturer(): string {
    return 'EdilKamin';
  }
  getIsOn(): boolean {
    return this.getDATR0(StoveRegisters.INDEX_STOVE_IS_ON) === 1;
  }
  getRoomTemperature(): number | undefined {
    const val = this.getDATR0(StoveRegisters.INDEX_TEMPERATURE_ROOM1);
    return val !== undefined ? val / TEMP_SCALE : undefined;
  }
  getSetTemperature(): number | undefined {
    const val = this.getDATR0(StoveRegisters.INDEX_SET_TEMPERATURE_ROOM1);
    return val !== undefined ? val / TEMP_SCALE : undefined;
  }
  getFanSpeed(): number | undefined {
    return this.getDATR0(StoveRegisters.INDEX_SPEED_FAN1);
  }
  getPowerLevel(): number | undefined {
    return this.getDATR0(StoveRegisters.INDEX_POWER_LEVEL);
  }
  getSmokeTemperature(): number | undefined {
    const val = this.getDATR0(StoveRegisters.INDEX_SMOKE_TEMPERATURE);
    return val !== undefined ? val / TEMP_SCALE : undefined;
  }
  getState(): string {
    const state = this.getDATR0(StoveRegisters.INDEX_STOVE_STATE);
    return state !== undefined && state in StoveStateMap ? StoveStateMap[state as keyof typeof StoveStateMap] : 'unknown';
  }
  isInAlarm(): boolean {
    return this.getState() === 'alarm';
  }

  // --- Minimal protocol send/parse ---
  // For write commands (parameter, value)
  private async sendCommand(params: [string, string]): Promise<void> {
    if (!this.client) throw new Error('Socket not connected');
    const command = ProtocolCommands.DATA_COMMAND;
    const mode = 'W';
    const parameters = params;
    console.log('[HottohStove] sendCommand: parameters', parameters, 'types', parameters.map(p => typeof p));
    const frame = this.buildRequestFrame(command, mode, parameters);
    this.client.write(frame);
    console.log('[HottohStove] Sent command:', frame.toString('hex'), '(', frame.toString('utf8').replace(/[^\x20-\x7E]/g, '.'), ')');
    // Wait for DATWOK (write OK) or DATR0 (state update) to confirm command processed
    await new Promise<void>((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      const onData = (data: Buffer) => {
        const str = data.toString('utf8').trim();
        if (str.includes('DATWOK')) {
          console.log('[HottohStove] sendCommand: received DATWOK after write');
          if (this.client) this.client.off('data', onData);
          if (timeout) clearTimeout(timeout);
          resolve();
        } else if (str.includes('DATR0')) {
          this.parseData(data);
          if (this.client) this.client.off('data', onData);
          if (timeout) clearTimeout(timeout);
          console.log('[HottohStove] sendCommand: received DATR0 after write');
          resolve();
        }
      };
      this.client!.on('data', onData);
      timeout = setTimeout(() => {
        if (this.client) this.client.off('data', onData);
        console.error('[HottohStove] sendCommand: Timeout waiting for DATWOK or DATR0 after write');
        reject(new Error('Timeout waiting for DATWOK or DATR0 after write'));
      }, 5000);
    });
  }

  // For protocol reads (INFO, DATR0)
  private sendReadCommand(command: string, params: string[] = []): void {
    if (!this.client) throw new Error('Socket not connected');
    const mode = 'R';
    const frame = this.buildRequestFrame(command, mode, params);
    this.client.write(frame);
    console.log('[HottohStove] Sent read command:', frame.toString('hex'), '(', frame.toString('utf8').replace(/[^\x20-\x7E]/g, '.'), ')');
  }

  // Build protocol request frame (matches Python hottohpy)
  private buildRequestFrame(command: string, mode: string, parameters: string[]): Buffer {
    // Socket ID is always 00000 (5 chars)
    const socketId = '00000';
    // Parameters string (each param + ;)
    const paramStr = parameters.map(p => p + ProtocolConstants.PARAM_SEPARATOR).join('');
    // Length of parameters (in hex, 4 chars, zero-padded)
    const lenParameters = paramStr.length.toString(16).toUpperCase().padStart(4, '0');
    // Raw data: [len][command][mode][params]
    const rawData = lenParameters + command + mode + paramStr;
    // Data for CRC: [socketId][C---][rawData]
    const dataForCrc = socketId + 'C---' + rawData;
    // CRC16-CCITT-FALSE (hex, lowercase, 4 chars)
    const crc = this.crc16ccittFalse(Buffer.from(dataForCrc, 'utf8')).toLowerCase();
    // Final frame: #[socketId]C---[rawData][crc]\n
    const frameStr = ProtocolConstants.PROTOCOL_PREFIX + dataForCrc + crc + '\n';
    return Buffer.from(frameStr, 'utf8');
  }

  // CRC16-CCITT-FALSE implementation (matches Python hottohpy)
  private crc16ccittFalse(buf: Buffer): string {
    let crc = 0xFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i] << 8;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = (crc << 1) ^ 0x1021;
        } else {
          crc = crc << 1;
        }
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  private parseData(data: Buffer): void {
    // Minimal parse: split by ;, parse as numbers, store in correct array
    const str = data.toString('utf8').trim();
    if (!str) return;
    if (str.includes('INFRHOTTOH')) {
      this.infoLine = str;
      console.log('[HottohStove] Parsed INFO:', this.infoLine);
    } else if (str.includes('DATR0')) {
      this.rawDATR0 = str;
      const parts = str.split(ProtocolConstants.PARAM_SEPARATOR).map(s => parseFloat(s));
      this.dataDATR0 = parts;
      console.log('[HottohStove] Parsed DATR0:', this.dataDATR0);
    } else {
      console.log('[HottohStove] Ignored data:', str);
    }
  }

  // Send a command and wait for a response containing the expected marker
  private async sendAndWaitFor(cmdType: 'INFO' | 'DATR0', marker: string): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      const onData = (data: Buffer) => {
        const str = data.toString('utf8').trim();
        if (str.includes(marker)) {
          this.parseData(data);
          if (this.client) this.client.off('data', onData);
          if (timeout) clearTimeout(timeout);
          resolve();
        }
      };
      if (!this.client) return reject(new Error('Socket not connected'));
      this.client.on('data', onData);
      // Send the correct command
      if (cmdType === 'INFO') {
        this.sendReadCommand(ProtocolCommands.INFO_COMMAND);
      } else if (cmdType === 'DATR0') {
        this.sendReadCommand(ProtocolCommands.DATA_COMMAND, ['0']);
      }
      // Timeout if no response
      timeout = setTimeout(() => {
        if (this.client) this.client.off('data', onData);
        reject(new Error(`Timeout waiting for response: ${marker}`));
      }, 5000);
    });
  }

  // Utility: delay for ms milliseconds
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Expose raw protocol data for debugging/logging
  getRawInfo(): string | null { return this.infoLine; }
  getRawDATR0(): string | null { return this.rawDATR0; }
  getTargetTemperature(): number | undefined {
    return this.getSetTemperature();
  }
}
