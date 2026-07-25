// Bucket placeholders are replaced with escaped Flux string literals by
// InfluxTaskProvisionerService before this script is sent to InfluxDB.
option task = {name: "kpi_hourly_aggregation", every: 1h, offset: 5m}

sampleIntervalSeconds = 5.0
expectedSamplesPerHour = 720.0

data =
    from(bucket: "__INFLUXDB_BUCKET__")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "controller_history")
        |> filter(fn: (r) => r.data_quality == "good")
        |> filter(
            fn: (r) =>
                r._field == "temperature_c" or r._field == "humidity_percent" or
                    r._field == "temp_target" or r._field == "humid_target" or
                    r._field == "mist_state" or r._field == "lamp_state" or
                    r._field == "config_revision",
        )
        |> pivot(
            rowKey: ["_time", "device_id", "control_source"],
            columnKey: ["_field"],
            valueColumn: "_value",
        )
        // A KPI sample is only trustworthy when all inputs used by its metrics
        // are present. Good-quality partial rows must not inflate coverage.
        |> filter(
            fn: (r) =>
                exists r.temperature_c and exists r.humidity_percent and
                    exists r.temp_target and exists r.humid_target and
                    exists r.mist_state and exists r.lamp_state and
                    exists r.config_revision,
        )
        |> map(
            fn: (r) =>
                ({
                    r with
                    config_revision: string(v: r.config_revision),
                    temp_squared_error:
                        (float(v: r.temperature_c) - float(v: r.temp_target)) *
                            (float(v: r.temperature_c) - float(v: r.temp_target)),
                    humid_squared_error:
                        (float(v: r.humidity_percent) - float(v: r.humid_target)) *
                            (float(v: r.humidity_percent) - float(v: r.humid_target)),
                }),
        )
        |> group(columns: ["device_id", "control_source", "config_revision"])
        |> sort(columns: ["_time"])

data
    |> reduce(
        identity: {
            sample_count: 0.0,
            sum_squared_error_temp: 0.0,
            sum_squared_error_humid: 0.0,
            mist_switch_count: 0.0,
            mist_on_duration_s: 0.0,
            lamp_on_duration_s: 0.0,
            lamp_session_count: 0.0,
            overshoot_temp_duration_s: 0.0,
            undershoot_temp_duration_s: 0.0,
            previous_mist_on: false,
            previous_lamp_on: false,
            has_previous_state: false,
        },
        fn: (r, accumulator) =>
            ({
                sample_count: accumulator.sample_count + 1.0,
                sum_squared_error_temp:
                    accumulator.sum_squared_error_temp + r.temp_squared_error,
                sum_squared_error_humid:
                    accumulator.sum_squared_error_humid + r.humid_squared_error,
                // Count only observed false -> true transitions; do not infer a
                // transition at the beginning of an aggregation window.
                mist_switch_count:
                    accumulator.mist_switch_count +
                        (if accumulator.has_previous_state and
                                not accumulator.previous_mist_on and r.mist_state
                            then 1.0
                            else 0.0),
                mist_on_duration_s:
                    accumulator.mist_on_duration_s +
                        (if r.mist_state then sampleIntervalSeconds else 0.0),
                // Duration is accumulated from fixed 5-second control ticks;
                // averaging relay states would undercount partial windows.
                lamp_on_duration_s:
                    accumulator.lamp_on_duration_s +
                        (if r.lamp_state then sampleIntervalSeconds else 0.0),
                lamp_session_count:
                    accumulator.lamp_session_count +
                        (if accumulator.has_previous_state and
                                not accumulator.previous_lamp_on and r.lamp_state
                            then 1.0
                            else 0.0),
                overshoot_temp_duration_s:
                    accumulator.overshoot_temp_duration_s +
                        (if float(v: r.temperature_c) > float(v: r.temp_target) + 0.5
                        then sampleIntervalSeconds
                        else 0.0),
                undershoot_temp_duration_s:
                    accumulator.undershoot_temp_duration_s +
                        (if float(v: r.temperature_c) < float(v: r.temp_target) - 0.5
                        then sampleIntervalSeconds
                        else 0.0),
                previous_mist_on: r.mist_state,
                previous_lamp_on: r.lamp_state,
                has_previous_state: true,
            }),
    )
    |> map(
        fn: (r) =>
            ({
                r with
                expected_samples: expectedSamplesPerHour,
                valid_samples: r.sample_count,
                data_coverage_percent: r.sample_count / expectedSamplesPerHour * 100.0,
                lamp_avg_on_duration_s:
                    if r.lamp_session_count > 0.0
                    then r.lamp_on_duration_s / r.lamp_session_count
                    else 0.0,
            }),
    )
    |> to(
        bucket: "__INFLUXDB_ANALYTICS_BUCKET__",
        measurement: "kpi_metrics_1h",
        tagColumns: ["device_id", "control_source", "config_revision"],
        fieldFn: (r) =>
            ({
                sample_count: r.sample_count,
                sum_squared_error_temp: r.sum_squared_error_temp,
                sum_squared_error_humid: r.sum_squared_error_humid,
                mist_switch_count: r.mist_switch_count,
                mist_on_duration_s: r.mist_on_duration_s,
                lamp_on_duration_s: r.lamp_on_duration_s,
                lamp_session_count: r.lamp_session_count,
                lamp_avg_on_duration_s: r.lamp_avg_on_duration_s,
                overshoot_temp_duration_s: r.overshoot_temp_duration_s,
                undershoot_temp_duration_s: r.undershoot_temp_duration_s,
                expected_samples: r.expected_samples,
                valid_samples: r.valid_samples,
                data_coverage_percent: r.data_coverage_percent,
            }),
    )
