class_name Combat
## Общая геометрия боя и границы арены.

const ARENA_MIN := Vector2(10, 36)
const ARENA_MAX := Vector2(470, 212)
const ENEMY_MIN := Vector2(6, 14)
const ENEMY_MAX := Vector2(474, 216)
const GATE_POS := Vector2(240, 214)


## Попадает ли цель (с радиусом) в сектор удара.
static func in_arc(origin: Vector2, facing: Vector2, target: Vector2, reach: float, half_angle: float, target_radius: float = 0.0) -> bool:
	var d := target - origin
	var dist := d.length()
	if dist > reach + target_radius:
		return false
	if dist <= target_radius:
		return true
	return absf(facing.angle_to(d)) <= half_angle
