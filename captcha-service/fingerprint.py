from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional


@dataclass
class TrajectoryPoint:
    timestamp: int
    value: float
    delta: float
    velocity: float
    time_delta_ms: int


@dataclass
class BehaviorData:
    start_time: int
    end_time: int
    total_duration_ms: int
    event_count: int
    mouse_down_count: int
    mouse_move_count: int
    events: List[dict]


@dataclass
class CaptchaSession:
    solved_value: int
    fingerprint: Optional[dict] = None
    trajectory: Optional[List[TrajectoryPoint]] = None
    behavior: Optional[BehaviorData] = None


def parse_trajectory(trajectory: Any) -> list[TrajectoryPoint]:
    parsed_trajectory: list[TrajectoryPoint] = []
    if not isinstance(trajectory, list):
        return parsed_trajectory

    for point in trajectory[:600]:
        if not isinstance(point, dict):
            continue
        try:
            parsed_trajectory.append(
                TrajectoryPoint(
                    timestamp=int(point.get("timestamp", 0)),
                    value=float(point.get("value", 0)),
                    delta=float(point.get("delta", 0)),
                    velocity=float(point.get("velocity", 0)),
                    time_delta_ms=max(0, int(point.get("time_delta_ms", 0))),
                )
            )
        except Exception:
            continue

    return parsed_trajectory


def parse_behavior(behavior: Any) -> BehaviorData | None:
    if not isinstance(behavior, dict):
        return None

    try:
        return BehaviorData(
            start_time=int(behavior.get("start_time", 0) or 0),
            end_time=int(behavior.get("end_time", 0) or 0),
            total_duration_ms=max(0, int(behavior.get("total_duration_ms", 0) or 0)),
            event_count=max(0, int(behavior.get("event_count", 0) or 0)),
            mouse_down_count=max(0, int(behavior.get("mouse_down_count", 0) or 0)),
            mouse_move_count=max(0, int(behavior.get("mouse_move_count", 0) or 0)),
            events=behavior.get("events") or []
            if isinstance(behavior.get("events"), list)
            else [],
        )
    except Exception:
        return None


def compute_pow_difficulty(
    fingerprint: dict | None = None,
    trajectory: list[TrajectoryPoint] | None = None,
    behavior: BehaviorData | None = None,
) -> dict[str, Any]:
    """
    Compute PoW difficulty from post-solve session data.

    Runs the same risk analysis used by ``analyze_bot_risk`` and maps
    the resulting confidence score to a difficulty tier:

      - score >= 70  →  low risk   →  difficulty 15  (~32K hashes, fast)
      - score >= 40  →  medium     →  difficulty 20  (~1M hashes)
      - score <  40  →  high risk  →  difficulty 26  (~67M hashes)

    Returns ``{ difficulty, risk_level, score, flags }``.
    """
    session = CaptchaSession(
        solved_value=0,
        fingerprint=fingerprint,
        trajectory=trajectory,
        behavior=behavior,
    )
    result = analyze_bot_risk(session)
    score = result["confidence_score"]

    if score >= 70:
        risk_level, difficulty = "low", 15
    elif score >= 40:
        risk_level, difficulty = "medium", 19
    else:
        risk_level, difficulty = "high", 22

    return {
        "difficulty": difficulty,
        "risk_level": risk_level,
        "score": score,
        "flags": result["flags"],
    }


def analyze_bot_risk(session: CaptchaSession) -> dict[str, Any]:
    flags = []
    score = 100
    if session.fingerprint:
        fp = session.fingerprint
        user_agent = str(fp.get("user_agent") or "")
        if len(user_agent) < 20:
            flags.append("suspicious_user_agent")
            score -= 20

        screen_resolution = str(fp.get("screen_resolution") or "")
        try:
            screen_w, screen_h = [
                int(v) for v in screen_resolution.lower().split("x", 1)
            ]
            if screen_w <= 0 or screen_h <= 0:
                flags.append("invalid_screen_resolution")
                score -= 15
        except Exception:
            flags.append("invalid_screen_resolution")
            score -= 15

        if bool(fp.get("webdriver")):
            flags.append("webdriver_detected")
            score -= 35

        if not fp.get("timezone_name"):
            flags.append("missing_timezone")
            score -= 5

        if not fp.get("canvas_fingerprint"):
            flags.append("missing_canvas_fingerprint")
            score -= 10
    else:
        flags.append("missing_fingerprint")
        score -= 30

    if session.trajectory and len(session.trajectory) >= 4:
        velocities = [p.velocity for p in session.trajectory if p.time_delta_ms > 0]
        if velocities:
            vel_mean = sum(velocities) / len(velocities)
            vel_variance = sum((v - vel_mean) ** 2 for v in velocities) / len(velocities)
            if vel_variance < 0.003:
                flags.append("linear_velocity_pattern")
                score -= 20

        non_zero_deltas = [abs(p.delta) for p in session.trajectory if p.delta != 0]
        if non_zero_deltas:
            delta_mean = sum(non_zero_deltas) / len(non_zero_deltas)
            delta_variance = sum((d - delta_mean) ** 2 for d in non_zero_deltas) / len(
                non_zero_deltas
            )
            if delta_variance < 0.2 and len(non_zero_deltas) >= 4:
                flags.append("uniform_delta_pattern")
                score -= 15

        unique_values = {int(p.value) for p in session.trajectory}
        if len(unique_values) < 4:
            flags.append("low_slider_entropy")
            score -= 15

        time_deltas = [p.time_delta_ms for p in session.trajectory if p.time_delta_ms > 0]
        if time_deltas:
            pauses = [d for d in time_deltas if d >= 120]
            if len(pauses) == 0:
                flags.append("no_movement_pauses")
                score -= 15
    else:
        flags.append("insufficient_trajectory_data")
        score -= 30

    if session.behavior:
        duration = session.behavior.total_duration_ms
        if duration <= 0:
            flags.append("invalid_behavior_duration")
            score -= 20
        elif duration < 300:
            flags.append("suspiciously_fast")
            score -= 25
        elif duration < 700:
            flags.append("very_fast")
            score -= 10
        elif duration > 45000:
            flags.append("suspiciously_slow")
            score -= 10

        if session.behavior.mouse_down_count < 1:
            flags.append("missing_mousedown")
            score -= 10

        if session.behavior.mouse_move_count < 3:
            flags.append("insufficient_mouse_movement")
            score -= 20
        elif session.behavior.mouse_move_count < 8:
            flags.append("limited_mouse_movement")
            score -= 10

        if session.behavior.event_count < 3:
            flags.append("low_event_count")
            score -= 10
    else:
        flags.append("missing_behavior_data")
        score -= 25

    score = max(0, min(100, score))
    is_bot = score < 60
    return {
        "is_bot": is_bot,
        "confidence_score": score,
        "flags": flags,
        "details": {
            "fingerprint_present": session.fingerprint is not None,
            "trajectory_points": len(session.trajectory) if session.trajectory else 0,
            "total_duration_ms": session.behavior.total_duration_ms
            if session.behavior
            else 0,
            "movement_events": session.behavior.mouse_move_count
            if session.behavior
            else 0,
        },
    }
