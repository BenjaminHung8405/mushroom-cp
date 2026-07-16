#include "core/math_engine.h"
#include <cmath>

namespace {

// Integral of x * membership_function_1(x) from 0 to z
// Pascal: Result := z*z*z*(w2/8 - w3/2)/3 + z*z*w3/2;
float Fz1(float z, float w2, float w3) {
    return (z * z * z * (w2 / 8.0f - w3 / 2.0f)) / 3.0f + (z * z * w3) / 2.0f;
}

// Integral of x * membership_function_2(x) from 0 to z
// Pascal: Result := z*z*z*w2/24;
float Fz2(float z, float w2) {
    return (z * z * z * w2) / 24.0f;
}

// Integral of x * membership_function_3(x) from 0 to z
// Pascal: Result := z*z*z*(w1 - w2)/21 + z*z*(15*w2 - 8*w1)/14;
float Fz3(float z, float w1, float w2) {
    return (z * z * z * (w1 - w2)) / 21.0f + (z * z * (15.0f * w2 - 8.0f * w1)) / 14.0f;
}

// Integral of membership_function_1(x) from 0 to z
// Pascal: Result := z*z*(w2/16 - w3/4) + z*w3;
float Fu1(float z, float w2, float w3) {
    return z * z * (w2 / 16.0f - w3 / 4.0f) + z * w3;
}

// Integral of membership_function_2(x) from 0 to z
// Pascal: Result := z*z*w2/16;
float Fu2(float z, float w2) {
    return (z * z * w2) / 16.0f;
}

// Integral of membership_function_3(x) from 0 to z
// Pascal: Result := z*z*(w1 - w2)/14 + z*(15*w2 - 8*w1)/7;
float Fu3(float z, float w1, float w2) {
    return (z * z * (w1 - w2)) / 14.0f + (z * (15.0f * w2 - 8.0f * w1)) / 7.0f;
}

} // namespace

namespace MathEngine {

float calculateFuzzyArea(float w1, float w2, float w3, float& Kz, float& K) {
    // Input sanitization: if inputs are invalid (NaN, Inf), fallback to safe values.
    if (std::isnan(w1) || std::isinf(w1) || 
        std::isnan(w2) || std::isinf(w2) || 
        std::isnan(w3) || std::isinf(w3)) {
        Kz = 0.0f;
        K = 0.0f;
        return 0.0f;
    }

    // Centroid numerator Kz (sum of moments of membership intervals)
    // Intervals: [0, 2] for Fz1, [2, 8] for Fz2, [8, 15] for Fz3
    Kz = (Fz1(2.0f, w2, w3) - Fz1(0.0f, w2, w3)) +
         (Fz2(8.0f, w2) - Fz2(2.0f, w2)) +
         (Fz3(15.0f, w1, w2) - Fz3(8.0f, w1, w2));

    // Centroid denominator K (sum of areas of membership intervals)
    // Intervals: [0, 2] for Fu1, [2, 8] for Fu2, [8, 15] for Fu3
    K = (Fu1(2.0f, w2, w3) - Fu1(0.0f, w2, w3)) +
        (Fu2(8.0f, w2) - Fu2(2.0f, w2)) +
        (Fu3(15.0f, w1, w2) - Fu3(8.0f, w1, w2));

    // Fallback logic to avoid division by zero, NaN, or Inf
    float TB = 0.0f;
    if (std::isnan(K) || std::isinf(K) || std::isnan(Kz) || std::isinf(Kz)) {
        TB = 0.0f;
    } else if (std::abs(K) > 1e-6f) {
        TB = Kz / K;
    } else {
        TB = 0.0f;
    }

    // Physical constraint: if TB < 1.0, clamp to 0.0
    if (TB < 1.0f) {
        TB = 0.0f;
    }

    return TB;
}

float calculateFuzzyArea(float w1, float w2, float w3) {
    float dummy_Kz = 0.0f;
    float dummy_K = 0.0f;
    return calculateFuzzyArea(w1, w2, w3, dummy_Kz, dummy_K);
}

float computeMembership(float x, float a, float b, float c) {
    if (std::isnan(x) || std::isinf(x) || 
        std::isnan(a) || std::isinf(a) || 
        std::isnan(b) || std::isinf(b) || 
        std::isnan(c) || std::isinf(c)) {
        return 0.0f;
    }

    if (x <= a || x >= c) {
        if (x == b) {
            return 1.0f;
        }
        return 0.0f;
    }
    if (x == b) {
        return 1.0f;
    }

    float val = 0.0f;
    if (x < b) {
        if (b > a) {
            val = (x - a) / (b - a);
        }
    } else {
        if (c > b) {
            val = (c - x) / (c - b);
        }
    }

    return (val < 0.0f) ? 0.0f : ((val > 1.0f) ? 1.0f : val);
}

float computeMembership(float x, float a, float b, float c, float d) {
    if (std::isnan(x) || std::isinf(x) || 
        std::isnan(a) || std::isinf(a) || 
        std::isnan(b) || std::isinf(b) || 
        std::isnan(c) || std::isinf(c) || 
        std::isnan(d) || std::isinf(d)) {
        return 0.0f;
    }

    if (x <= a || x >= d) {
        if (x >= b && x <= c) {
            return 1.0f;
        }
        return 0.0f;
    }
    if (x >= b && x <= c) {
        return 1.0f;
    }

    float val = 0.0f;
    if (x < b) {
        if (b > a) {
            val = (x - a) / (b - a);
        }
    } else {
        if (d > c) {
            val = (d - x) / (d - c);
        }
    }

    return (val < 0.0f) ? 0.0f : ((val > 1.0f) ? 1.0f : val);
}

} // namespace MathEngine
