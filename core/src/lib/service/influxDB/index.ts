import { InfluxDB, Point, HttpError } from '@influxdata/influxdb-client';
import {
  BucketsAPI,
  OrgsAPI,
  SetupAPI,
} from '@influxdata/influxdb-client-apis';
import { Logger } from '@nestjs/common';
import { InfluxDBEnv } from './env';
import { config } from '../../../generator/config/config.service';

const { url, username, password, org, bucket, token } = InfluxDBEnv;

const influxDB = new InfluxDB({ url, token });

export class InfluxDBConnector {
  static async onBoardInfluxDB() {
    if (!config.write_to_influxdb) {
      return;
    }
    Logger.log('[influxDB] ONBOARDING');
    const setupApi = new SetupAPI(new InfluxDB({ url }));
    try {
      const { allowed } = await setupApi.getSetup();
      if (allowed) {
        await setupApi.postSetup({
          body: {
            org,
            bucket,
            username,
            password,
            token,
          },
        });
        Logger.log(`[influxDB] '${url}' is now onboarded.`);
      } else {
        Logger.log(`[influxDB] '${url}' has been already onboarded.`);
      }
    } catch (e) {
      Logger.error(e);
    }
  }

  static async recreateBucket(name = bucket) {
    if (!config.write_to_influxdb) {
      return;
    }
    const orgsAPI = new OrgsAPI(influxDB);
    const organizations = await orgsAPI.getOrgs({ org });
    if (!organizations || !organizations.orgs || !organizations.orgs.length) {
      Logger.error(`[influxDB] No organization named "${org}" found!`);
    }
    const orgID = organizations.orgs[0].id;

    const bucketsAPI = new BucketsAPI(influxDB);
    try {
      const buckets = await bucketsAPI.getBuckets({ orgID, name });
      if (buckets && buckets.buckets && buckets.buckets.length) {
        Logger.log(`[influxDB] Bucket named "${name}" already exists"`);
        const bucketID = buckets.buckets[0].id;
        Logger.log(
          `[influxDB] Delete Bucket "${name}" identified by "${bucketID}" `,
        );
        await bucketsAPI.deleteBucketsID({ bucketID });
      }
    } catch (e) {
      if (e instanceof HttpError && e.statusCode == 404) {
        // OK, bucket not found
      } else {
        throw e;
      }
    }

    // creates a bucket, entity properties are specified in the "body" property
    const bucket = await bucketsAPI.postBuckets({
      body: {
        orgID,
        name,
        retentionRules: [{ everySeconds: 0, type: 'expire' }],
      },
    });
    Logger.log(
      `[influxDB] Bucket created. ID: ${bucket.id}, Name: ${bucket.name}`,
    );
  }
  static async writePoints(points: Point[]) {
    if (!config.write_to_influxdb) {
      return;
    }
    // create a write API, expecting point timestamps in nanoseconds (can be also 's', 'ms', 'us')
    const writeApi = new InfluxDB({ url, token }).getWriteApi(
      org,
      bucket,
      'ns',
    );

    writeApi.writePoints(points);

    // WriteApi always buffer data into batches to optimize data transfer to InfluxDB server.
    // writeApi.flush() can be called to flush the buffered data. The data is always written
    // asynchronously, Moreover, a failed write (caused by a temporary networking or server failure)
    // is retried automatically. Read `writeAdvanced.js` for better explanation and details.
    //
    // close() flushes the remaining buffered data and then cancels pending retries.
    try {
      await writeApi.close();
    } catch (e) {
      Logger.error('[influxDB] write failed, ', e);
      if (e instanceof HttpError && e.statusCode === 401) {
        Logger.error('[influxDB] Setup a new InfluxDB database first');
      }
    }
  }

  static async writePointsFromDocker(points: Point[]) {
    if (!config.write_to_influxdb) {
      return;
    }
    // create a write API, expecting point timestamps in nanoseconds (can be also 's', 'ms', 'us')
    const port = new URL(url).port;
    const influxUrl = port
      ? `http://host.docker.internal:${port}`
      : `http://host.docker.internal`;
    const writeApi = new InfluxDB({ url: influxUrl, token }).getWriteApi(
      org,
      bucket,
      'ns',
    );

    writeApi.writePoints(points);

    // WriteApi always buffer data into batches to optimize data transfer to InfluxDB server.
    // writeApi.flush() can be called to flush the buffered data. The data is always written
    // asynchronously, Moreover, a failed write (caused by a temporary networking or server failure)
    // is retried automatically. Read `writeAdvanced.js` for better explanation and details.
    //
    // close() flushes the remaining buffered data and then cancels pending retries.
    try {
      await writeApi.close();
      Logger.log('[influxDB] write from Docker success');
    } catch (e) {
      Logger.error(e);
      if (e instanceof HttpError && e.statusCode === 401) {
        Logger.error('[influxDB] Setup a new InfluxDB database first');
      }
    }
  }
}
