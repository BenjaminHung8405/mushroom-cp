// Bucket placeholders are replaced with escaped Flux string literals by
// InfluxTaskProvisionerService before this script is sent to InfluxDB.
option task = {name: "kpi_hourly_aggregation", every: 1h, offset: 5m}

// Canonical controller_history is emitted at one approved scheduled cadence.
// Forced publishes share a slot and are deduplicated before aggregation.
allowedIntervals = [30, 60, 300]

data =
    from(bucket: "__INFLUXDB_BUCKET__")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "controller_history" and r.data_quality == "good")
        |> filter(fn: (r) =>
            r._field == "temperature_c" or r._field == "humidity_percent" or
            r._field == "temp_target" or r._field == "humid_target" or
            r._field == "mist_state" or r._field == "lamp_state" or
            r._field == "config_revision" or r._field == "telemetry_interval_sec")
        |> pivot(rowKey: ["_time", "device_id", "control_source", "publish_reason"], columnKey: ["_field"], valueColumn: "_value")
        |> filter(fn: (r) =>
            exists r.temperature_c and exists r.humidity_percent and exists r.temp_target and
            exists r.humid_target and exists r.mist_state and exists r.lamp_state and
            exists r.config_revision and exists r.telemetry_interval_sec and
            contains(value: int(v: r.telemetry_interval_sec), set: allowedIntervals))
        |> map(fn: (r) => ({r with
            config_revision: string(v: r.config_revision),
            effective_interval_s: float(v: r.telemetry_interval_sec),
            slot: int(v: uint(v: r._time) / uint(v: int(v: r.telemetry_interval_sec) * 1000000000)),
            temp_squared_error: (float(v: r.temperature_c) - float(v: r.temp_target)) * (float(v: r.temperature_c) - float(v: r.temp_target)),
            humid_squared_error: (float(v: r.humidity_percent) - float(v: r.humid_target)) * (float(v: r.humidity_percent) - float(v: r.humid_target)),
        }))
        |> group(columns: ["device_id", "control_source", "config_revision", "telemetry_interval_sec", "slot"])
        |> sort(columns: ["_time"])
        |> first()
        |> group(columns: ["device_id", "control_source", "config_revision", "telemetry_interval_sec"])
        |> sort(columns: ["_time"])

data
    |> reduce(
        identity: {sample_count: 0.0, sum_squared_error_temp: 0.0, sum_squared_error_humid: 0.0, mist_switch_count: 0.0, mist_on_duration_s: 0.0, lamp_on_duration_s: 0.0, lamp_session_count: 0.0, overshoot_temp_duration_s: 0.0, undershoot_temp_duration_s: 0.0, forced_publish_count: 0.0, previous_mist_on: false, previous_lamp_on: false, has_previous_state: false},
        fn: (r, a) => ({
            sample_count: a.sample_count + 1.0,
            sum_squared_error_temp: a.sum_squared_error_temp + r.temp_squared_error,
            sum_squared_error_humid: a.sum_squared_error_humid + r.humid_squared_error,
            mist_switch_count: a.mist_switch_count + (if a.has_previous_state and not a.previous_mist_on and r.mist_state then 1.0 else 0.0),
            mist_on_duration_s: a.mist_on_duration_s + (if r.mist_state then r.effective_interval_s else 0.0),
            lamp_on_duration_s: a.lamp_on_duration_s + (if r.lamp_state then r.effective_interval_s else 0.0),
            lamp_session_count: a.lamp_session_count + (if a.has_previous_state and not a.previous_lamp_on and r.lamp_state then 1.0 else 0.0),
            overshoot_temp_duration_s: a.overshoot_temp_duration_s + (if float(v: r.temperature_c) > float(v: r.temp_target) + 0.5 then r.effective_interval_s else 0.0),
            undershoot_temp_duration_s: a.undershoot_temp_duration_s + (if float(v: r.temperature_c) < float(v: r.temp_target) - 0.5 then r.effective_interval_s else 0.0),
            forced_publish_count: a.forced_publish_count + (if r.publish_reason != "interval" then 1.0 else 0.0),
            previous_mist_on: r.mist_state, previous_lamp_on: r.lamp_state, has_previous_state: true,
        }),
    )
    |> map(fn: (r) => ({r with expected_samples: 3600.0 / float(v: r.telemetry_interval_sec), valid_samples: r.sample_count, data_coverage_percent: r.sample_count / (3600.0 / float(v: r.telemetry_interval_sec)) * 100.0, configured_interval_sec: float(v: r.telemetry_interval_sec), observed_interval_sec: float(v: r.telemetry_interval_sec), duplicate_slot_count: 0.0, data_quality_warning: false, lamp_avg_on_duration_s: if r.lamp_session_count > 0.0 then r.lamp_on_duration_s / r.lamp_session_count else 0.0}))
    |> to(bucket: "__INFLUXDB_ANALYTICS_BUCKET__", measurement: "kpi_metrics_1h", tagColumns: ["device_id", "control_source", "config_revision", "telemetry_interval_sec"], fieldFn: (r) => ({sample_count: r.sample_count, sum_squared_error_temp: r.sum_squared_error_temp, sum_squared_error_humid: r.sum_squared_error_humid, mist_switch_count: r.mist_switch_count, mist_on_duration_s: r.mist_on_duration_s, lamp_on_duration_s: r.lamp_on_duration_s, lamp_session_count: r.lamp_session_count, lamp_avg_on_duration_s: r.lamp_avg_on_duration_s, overshoot_temp_duration_s: r.overshoot_temp_duration_s, undershoot_temp_duration_s: r.undershoot_temp_duration_s, expected_samples: r.expected_samples, valid_samples: r.valid_samples, data_coverage_percent: r.data_coverage_percent, configured_interval_sec: r.configured_interval_sec, observed_interval_sec: r.observed_interval_sec, forced_publish_count: r.forced_publish_count, duplicate_slot_count: r.duplicate_slot_count, data_quality_warning: r.data_quality_warning}))
