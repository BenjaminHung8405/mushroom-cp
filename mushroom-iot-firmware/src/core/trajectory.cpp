#include "core/trajectory.h"
#include <cmath>

namespace Trajectory
{

    struct Waypoint
    {
        float day;
        float temp_target;
        float humidity_target;
        float co2_target;
    };

    // 21-day Waypoints optimized for Tropical Straw Mushroom (Volvariella volvacea)
    // Hardened constraints: Snap to 0.5 increments for Temp/Hum. Bounded CO2.
    static constexpr Waypoint WAYPOINTS[] = {
        // --- GIAI ĐOẠN NUÔI TƠ (Spawn Running): Đèn nhiệt ON, Cần ấm, Ẩm cao, CO2 cao ---
        {0.0f, 33.0f, 90.0f, 1100.0f},
        {1.0f, 33.0f, 90.0f, 1100.0f},
        {2.0f, 32.5f, 89.5f, 1100.0f},
        {3.0f, 32.5f, 89.0f, 1050.0f},
        {4.0f, 32.0f, 88.5f, 1050.0f},
        {5.0f, 32.0f, 88.0f, 1000.0f},
        {6.0f, 32.0f, 88.0f, 1000.0f},
        {7.0f, 32.0f, 88.0f, 1000.0f},
        {8.0f, 32.0f, 88.0f, 1000.0f}, // Mốc cuối nuôi tơ (End of Spawn running)

        // --- GIAI ĐOẠN ĐỔI CHU KỲ (Pinning Trigger): Sốc nhiệt nhẹ, tăng ẩm kích ghim hạt ---
        {9.0f, 30.0f, 90.0f, 950.0f},  // Ngày 9: Đột ngột hạ temp xuống 30°C, đẩy ẩm lên 90%
        {10.0f, 29.5f, 89.0f, 900.0f}, // Tăng cường thông gió để xả bớt CO2 kích thích quả thể
        {11.0f, 29.5f, 88.5f, 900.0f},
        {12.0f, 29.0f, 88.0f, 900.0f},

        // --- GIAI ĐOẠN QUẢ THỂ PHÁT TRIỂN (Fruiting Stage): Đèn nhiệt OFF tuyệt đối ---
        {13.0f, 29.0f, 87.5f, 900.0f},
        {14.0f, 29.0f, 87.0f, 850.0f},
        {15.0f, 28.5f, 86.5f, 850.0f},
        {16.0f, 28.5f, 86.0f, 850.0f},
        {17.0f, 28.5f, 85.5f, 850.0f},
        {18.0f, 28.0f, 85.0f, 850.0f},
        {19.0f, 28.0f, 85.0f, 850.0f},
        {20.0f, 28.0f, 85.0f, 850.0f} // Thu hoạch vụ nấm chuẩn
    };

    static constexpr int NUM_WAYPOINTS = sizeof(WAYPOINTS) / sizeof(WAYPOINTS[0]);

    SetpointPod interpolateSetpoints(float currentDay)
    {
        // 1. Input sanitization & boundary protection: clamp currentDay to [0.0, 20.0]
        if (std::isnan(currentDay) || currentDay < 0.0f)
        {
            currentDay = 0.0f;
        }
        else if (currentDay > 20.0f)
        {
            currentDay = 20.0f;
        }

        // 2. Find interpolation interval
        int idx = 0;
        for (int i = 0; i < NUM_WAYPOINTS - 1; ++i)
        {
            if (currentDay >= WAYPOINTS[i].day && currentDay <= WAYPOINTS[i + 1].day)
            {
                idx = i;
                break;
            }
        }

        // 3. Linear interpolation calculation
        float t = 0.0f;
        float d1 = WAYPOINTS[idx].day;
        float d2 = WAYPOINTS[idx + 1].day;
        if (d2 > d1)
        {
            t = (currentDay - d1) / (d2 - d1);
        }

        SetpointPod target;
        target.temp_target = WAYPOINTS[idx].temp_target + t * (WAYPOINTS[idx + 1].temp_target - WAYPOINTS[idx].temp_target);
        target.humidity_target = WAYPOINTS[idx].humidity_target + t * (WAYPOINTS[idx + 1].humidity_target - WAYPOINTS[idx].humidity_target);
        target.co2_target = WAYPOINTS[idx].co2_target + t * (WAYPOINTS[idx + 1].co2_target - WAYPOINTS[idx].co2_target);

        return target;
    }

    bool interpolateSetpoint(
        uint16_t cropDay,
        const PersistedCropProfile &profile,
        float &temp_target,
        float &humidity_target)
    {
        if (profile.checkpoint_count == 0)
        {
            return false;
        }

        if (cropDay <= profile.checkpoints[0].crop_day)
        {
            temp_target = profile.checkpoints[0].temp_target_c;
            humidity_target = profile.checkpoints[0].humidity_target_rh;
        }
        else if (cropDay >= profile.checkpoints[profile.checkpoint_count - 1].crop_day)
        {
            temp_target = profile.checkpoints[profile.checkpoint_count - 1].temp_target_c;
            humidity_target = profile.checkpoints[profile.checkpoint_count - 1].humidity_target_rh;
        }
        else
        {
            uint16_t idx = 0;
            for (uint16_t i = 0; i < profile.checkpoint_count - 1; ++i)
            {
                if (cropDay >= profile.checkpoints[i].crop_day && cropDay <= profile.checkpoints[i + 1].crop_day)
                {
                    idx = i;
                    break;
                }
            }

            float day_a = profile.checkpoints[idx].crop_day;
            float day_b = profile.checkpoints[idx + 1].crop_day;
            float val_temp_a = profile.checkpoints[idx].temp_target_c;
            float val_temp_b = profile.checkpoints[idx + 1].temp_target_c;
            float val_hum_a = profile.checkpoints[idx].humidity_target_rh;
            float val_hum_b = profile.checkpoints[idx + 1].humidity_target_rh;

            float t = (static_cast<float>(cropDay) - day_a) / (day_b - day_a);
            temp_target = val_temp_a + (val_temp_b - val_temp_a) * t;
            humidity_target = val_hum_a + (val_hum_b - val_hum_a) * t;
        }

        if (!std::isfinite(temp_target) || temp_target < 10.0f || temp_target > 45.0f)
        {
            return false;
        }
        if (!std::isfinite(humidity_target) || humidity_target < 30.0f || humidity_target > 95.0f)
        {
            return false;
        }

        return true;
    }

} // namespace Trajectory
