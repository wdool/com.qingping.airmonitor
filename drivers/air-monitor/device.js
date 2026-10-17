'use strict';

const { Device } = require('homey');

const TOKEN_URL = 'https://oauth.cleargrass.com/oauth2/token';
const DEVICES_URL = 'https://apis.cleargrass.com/v1/apis/devices';

class AirMonitorDevice extends Device {

  async onInit() {
    this.log('AirMonitorDevice has been initialized:', this.getName());

    this._token = null;
    this._tokenExpiry = 0;

    // Start polling immediately, then on interval
    await this._poll();
    this._startPolling();
  }

  _startPolling() {
    const intervalMinutes = Math.max(5, this.getSetting('poll_interval') || 5);
    this._pollInterval = this.homey.setInterval(
      () => this._poll(),
      intervalMinutes * 60 * 1000,
    );
  }

  _stopPolling() {
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  async onSettings({ newSettings }) {
    // Restart polling with new interval
    this._stopPolling();
    this._startPolling();
  }

  async onDeleted() {
    this._stopPolling();
    this.log('AirMonitorDevice deleted:', this.getName());
  }

  async _getToken() {
    // Return cached token if still valid (with 60s buffer)
    if (this._token && Date.now() < this._tokenExpiry - 60_000) {
      return this._token;
    }

    const { client_id, client_secret } = this.getStore();
    if (!client_id || !client_secret) {
      throw new Error('Missing API credentials. Please re-pair the device.');
    }

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
    if (!body.access_token) throw new Error('No access token received');

    this._token = body.access_token;
    this._tokenExpiry = Date.now() + ((body.expires_in || 3600) * 1000);

    return this._token;
  }

  async _poll() {
    try {
      const token = await this._getToken();

      const response = await fetch(`${DEVICES_URL}?timestamp=${Date.now()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const body = await response.json();
      const { mac } = this.getStore();

      // Find this device by MAC address
      const deviceData = mac
        ? body.devices?.find((d) => d.info?.mac === mac)
        : body.devices?.[0];

      if (!deviceData) {
        throw new Error('Device not found in API response');
      }

      await this._updateCapabilities(deviceData.data);
      await this.setAvailable();

    } catch (err) {
      this.error('Poll error:', err.message);
      await this.setUnavailable(err.message);
    }
  }

  async _updateCapabilities(data) {
    if (!data) return;

    const prevCo2 = this.getCapabilityValue('measure_co2');
    const prevPm25 = this.getCapabilityValue('measure_pm25');
    const prevPm10 = this.getCapabilityValue('measure_pm10');

    if (data.temperature?.value != null) {
      await this.setCapabilityValue('measure_temperature', data.temperature.value);
    }

    if (data.humidity?.value != null) {
      await this.setCapabilityValue('measure_humidity', data.humidity.value);
    }

    if (data.co2?.value != null) {
      const co2 = data.co2.value;
      await this.setCapabilityValue('measure_co2', co2);

      if (prevCo2 !== null) {
        this.driver.triggerCo2Threshold(
          this,
          { co2 },
          { co2, previousCo2: prevCo2 },
        );
      }
    }

    if (data.pm25?.value != null) {
      const pm25 = data.pm25.value;
      await this.setCapabilityValue('measure_pm25', pm25);

      if (prevPm25 !== null) {
        this.driver.triggerPm25Threshold(
          this,
          { pm25 },
          { pm25, previousPm25: prevPm25 },
        );
      }
    }

    if (data.pm10?.value != null) {
      const pm10 = data.pm10.value;
      await this.setCapabilityValue('measure_pm10', pm10);

      if (prevPm10 !== null) {
        this.driver.triggerPm10Threshold(
          this,
          { pm10 },
          { pm10, previousPm10: prevPm10 },
        );
      }
    }
  }

}

module.exports = AirMonitorDevice;
