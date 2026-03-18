/**
 * MIDI Bridge - Handles communication with Cubase via IAC Driver
 *
 * Uses the JZZ library for cross-platform MIDI access on macOS.
 * Sends CC messages to control Cubase and receives feedback.
 */

import JZZ from 'jzz';
import {
  MIDI_CHANNEL,
  IAC_PORT_TO_CUBASE,
  IAC_PORT_FROM_CUBASE,
  buildSysEx,
  parseSysEx,
  sysExBytesToString,
  SYSEX_MSG
} from './protocol.js';

class MidiBridge {
  constructor() {
    this.output = null;
    this.input = null;
    this.connected = false;
    this.feedbackValues = {};  // Stores last known values from Cubase
    this.pendingResponses = new Map(); // For SysEx request/response
    this.trackNames = {};
    this.projectInfo = {};
  }

  /**
   * Connect to IAC Driver MIDI ports
   */
  async connect() {
    try {
      const jzz = await JZZ();

      // List available MIDI ports for diagnostics
      const outputs = jzz.info().outputs;
      const inputs = jzz.info().inputs;

      console.error('[MIDI Bridge] Available outputs:', outputs.map(o => o.name).join(', '));
      console.error('[MIDI Bridge] Available inputs:', inputs.map(i => i.name).join(', '));

      // Try to connect to the specific IAC ports, fall back to any IAC port
      try {
        this.output = await JZZ().openMidiOut(IAC_PORT_TO_CUBASE);
      } catch {
        // Try generic IAC port
        const iacOut = outputs.find(o => o.name.includes('IAC'));
        if (iacOut) {
          this.output = await JZZ().openMidiOut(iacOut.name);
          console.error(`[MIDI Bridge] Connected to output: ${iacOut.name}`);
        } else {
          throw new Error('No IAC Driver output port found. Please configure IAC Driver in Audio MIDI Setup.');
        }
      }

      try {
        this.input = await JZZ().openMidiIn(IAC_PORT_FROM_CUBASE);
      } catch {
        const iacIn = inputs.find(i => i.name.includes('IAC'));
        if (iacIn) {
          this.input = await JZZ().openMidiIn(iacIn.name);
          console.error(`[MIDI Bridge] Connected to input: ${iacIn.name}`);
        } else {
          console.error('[MIDI Bridge] Warning: No IAC input port found. Feedback from Cubase will not be available.');
        }
      }

      // Set up input listener for feedback
      if (this.input) {
        this.input.connect((msg) => this._handleIncoming(msg));
      }

      this.connected = true;
      console.error('[MIDI Bridge] Connected to Cubase via IAC Driver');
      return true;
    } catch (err) {
      console.error('[MIDI Bridge] Connection error:', err.message);
      this.connected = false;
      return false;
    }
  }

  /**
   * Handle incoming MIDI messages from Cubase (feedback)
   */
  _handleIncoming(msg) {
    const bytes = Array.from(msg);

    // SysEx message
    if (bytes[0] === 0xF0) {
      const parsed = parseSysEx(bytes);
      if (parsed) {
        this._handleSysEx(parsed);
      }
      return;
    }

    // Control Change on our channel
    const status = bytes[0] & 0xF0;
    const channel = bytes[0] & 0x0F;

    if (status === 0xB0 && channel === MIDI_CHANNEL) {
      const cc = bytes[1];
      const value = bytes[2];
      this.feedbackValues[cc] = value;
    }
  }

  /**
   * Handle SysEx responses from Cubase
   */
  _handleSysEx(parsed) {
    const { msgType, data } = parsed;

    switch (msgType) {
      case SYSEX_MSG.TRACK_NAME_RESPONSE: {
        const trackIndex = data[0];
        const name = sysExBytesToString(data.slice(1));
        this.trackNames[trackIndex] = name;
        this._resolveResponse(SYSEX_MSG.TRACK_NAME_RESPONSE, { trackIndex, name });
        break;
      }
      case SYSEX_MSG.PROJECT_INFO_RESPONSE: {
        const infoStr = sysExBytesToString(data);
        try {
          this.projectInfo = JSON.parse(infoStr);
        } catch {
          this.projectInfo = { raw: infoStr };
        }
        this._resolveResponse(SYSEX_MSG.PROJECT_INFO_RESPONSE, this.projectInfo);
        break;
      }
      case SYSEX_MSG.TRACK_COUNT: {
        const count = data[0] | (data[1] << 7);
        this._resolveResponse(SYSEX_MSG.TRACK_COUNT, count);
        break;
      }
    }
  }

  /**
   * Send a CC message to Cubase
   */
  sendCC(cc, value) {
    if (!this.output) {
      throw new Error('MIDI output not connected. Run setup first.');
    }
    // Control Change on MIDI_CHANNEL
    const statusByte = 0xB0 | MIDI_CHANNEL;
    this.output.send([statusByte, cc & 0x7F, value & 0x7F]);
  }

  /**
   * Send a SysEx message to Cubase
   */
  sendSysEx(msgType, data = []) {
    if (!this.output) {
      throw new Error('MIDI output not connected. Run setup first.');
    }
    const sysex = buildSysEx(msgType, data);
    this.output.send(sysex);
  }

  /**
   * Send a SysEx request and wait for response
   */
  async requestSysEx(msgType, data = [], timeout = 2000) {
    return new Promise((resolve, reject) => {
      const responseType = msgType + 1; // Convention: response = request + 1
      const timer = setTimeout(() => {
        this.pendingResponses.delete(responseType);
        reject(new Error(`SysEx response timeout for message type ${msgType}`));
      }, timeout);

      this.pendingResponses.set(responseType, { resolve, timer });
      this.sendSysEx(msgType, data);
    });
  }

  _resolveResponse(msgType, data) {
    const pending = this.pendingResponses.get(msgType);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingResponses.delete(msgType);
      pending.resolve(data);
    }
  }

  /**
   * Get the last known feedback value for a CC
   */
  getFeedback(cc) {
    return this.feedbackValues[cc] ?? null;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      outputPort: this.output ? 'Connected' : 'Not connected',
      inputPort: this.input ? 'Connected' : 'Not connected',
      feedbackValues: { ...this.feedbackValues },
      trackNames: { ...this.trackNames },
    };
  }

  /**
   * Disconnect MIDI ports
   */
  async disconnect() {
    if (this.output) await this.output.close();
    if (this.input) await this.input.close();
    this.connected = false;
    console.error('[MIDI Bridge] Disconnected');
  }
}

// Singleton instance
const bridge = new MidiBridge();
export default bridge;
