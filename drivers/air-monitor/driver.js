'use strict';

const { Driver } = require('homey');

const TOKEN_URL = 'https://oauth.cleargrass.com/oauth2/token';
const DEVICES_URL = 'https://apis.cleargrass.com/v1/apis/devices';

class AirMonitorDriver extends Driver {

  async onInit() {
    this.log('AirMonitorDriver has been initialized');
    this._registerFlowCards();
  }

  _registerFlowCards() {
    // --- Triggers ---
    this._co2ThresholdTrigger = this.homey.flow.getDeviceTriggerCard('co2_threshold_exceeded');
    this._co2ThresholdTrigger.registerRunListener(async (args, state) => {
      return state.co2 >= args.threshold && state.previousCo2 < args.threshold;
    });

    this._pm25ThresholdTrigger = this.homey.flow.getDeviceTriggerCard('pm25_threshold_exceeded');
    this._pm25ThresholdTrigger.registerRunListener(async (args, state) => {
      return state.pm25 >= args.threshold && state.previousPm25 < args.threshold;
    });

    this._pm10ThresholdTrigger = this.homey.flow.getDeviceTriggerCard('pm10_threshold_exceeded');
    this._pm10ThresholdTrigger.registerRunListener(async (args, state) => {
      return state.pm10 >= args.threshold && state.previousPm10 < args.threshold;
    });

    // --- Conditions ---
    this.homey.flow.getConditionCard('co2_is_above')
      .registerRunListener(async (args) => {
        const value = args.device.getCapabilityValue('measure_co2');
        return value !== null && value >= args.threshold;
      });

    this.homey.flow.getConditionCard('pm25_is_above')
      .registerRunListener(async (args) => {
        const value = args.device.getCapabilityValue('measure_pm25');
        return value !== null && value >= args.threshold;
      });

    this.homey.flow.getConditionCard('pm10_is_above')
      .registerRunListener(async (args) => {
        const value = args.device.getCapabilityValue('measure_pm10');
        return value !== null && value >= args.threshold;
      });

    this.homey.flow.getConditionCard('humidity_is_above')
      .registerRunListener(async (args) => {
        const value = args.device.getCapabilityValue('measure_humidity');
        return value !== null && value >= args.threshold;
      });
  }

  // Called by devices to fire threshold triggers
  triggerCo2Threshold(device, tokens, state) {
    this._co2ThresholdTrigger.trigger(device, tokens, state).catch(this.error);
  }

  triggerPm25Threshold(device, tokens, state) {
    this._pm25ThresholdTrigger.trigger(device, tokens, state).catch(this.error);
  }

  triggerPm10Threshold(device, tokens, state) {
    this._pm10ThresholdTrigger.trigger(device, tokens, state).catch(this.error);
  }

  // --- Pairing ---
  async onPair(session) {
    let credentials = null;
    let fetchedToken = null;

    session.setHandler('login', async ({ username, password }) => {
      this.log('login handler called, username:', username);
      try {
        fetchedToken = await this._fetchToken(username, password);
        credentials = { client_id: username, client_secret: password };
        this.log('login success, token received');
        return true;
      } catch (err) {
        this.error('Pair login failed:', err.message);
        return false;
      }
    });

    session.setHandler('list_devices', async () => {
      this.log('list_devices handler called, fetchedToken:', !!fetchedToken, 'credentials:', !!credentials);
      try {
        if (!fetchedToken || !credentials) {
          throw new Error('Not authenticated. Please log in first.');
        }

        const devices = await this._fetchDevices(fetchedToken);
        this.log('devices fetched:', devices.length);

        return devices.map((device, index) => ({
          name: device.info?.name || `Qingping Air Monitor ${index + 1}`,
          data: {
            id: device.info?.mac || `qingping_device_${index}`,
          },
          store: {
            mac: device.info?.mac || null,
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
          },
        }));
      } catch (err) {
        this.error('list_devices failed:', err.message);
        throw err;
      }
    });
  }

  async _fetchToken(client_id, client_secret) {
    const credentials = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('scope', 'device_full_access');

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json();
    if (!body.access_token) {
      throw new Error('No access token in response');
    }

    return { access_token: body.access_token, expires_in: body.expires_in || 3600 };
  }

  async _fetchDevices(token) {
    const response = await fetch(`${DEVICES_URL}?timestamp=${Date.now()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Devices request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json();
    return body.devices || [];
  }

}

module.exports = AirMonitorDriver;
