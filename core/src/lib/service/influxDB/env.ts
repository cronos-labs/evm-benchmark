export class InfluxDBEnv {
  /** InfluxDB v2 URL */
  static url = process.env['INFLUX_URL'] || 'http://0.0.0.0:8086';
  /** InfluxDB authorization token */
  static token = process.env['INFLUX_TOKEN'] || 'my-token';
  /** Organization within InfluxDB  */
  static org = process.env['INFLUX_ORG'] || 'my-org';
  /**InfluxDB bucket used in examples  */
  static bucket = 'benchmark';
  // ONLY onboarding example
  /**InfluxDB user  */
  static username = 'my-user';
  /**InfluxDB password  */
  static password = 'my-password';
}
