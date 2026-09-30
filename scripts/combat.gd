class_name Combat
## Общая геометрия боя и границы карты.

const FIELD_MIN := Vector2(10, 36)
const FIELD_MAX := Vector2(470, 208)
const WALL_MIN := Vector2(8, 222)
const WALL_MAX := Vector2(472, 230)
const WALL_Y := 214.0
const ENEMY_MIN := Vector2(6, 14)
const ENEMY_MAX := Vector2(474, 212)
const GATE_POS := Vector2(240, 212)
## Проход через ворота между полем и стеной.
const GATE_WAY := Vector2(240, 214)


## Попадает ли цель (с радиусом) в сектор удара.
static func in_arc(origin: Vector2, facing: Vector2, target: Vector2, reach: float, half_angle: float, target_radius: float = 0.0) -> bool:
	var d := target - origin
	var dist := d.length()
	if dist > reach + target_radius:
		return false
	if dist <= target_radius:
		return true
	return absf(facing.angle_to(d)) <= half_angle


## Куда на самом деле встанет герой, если приказать ему идти в точку `p`.
static func clamp_order(p: Vector2) -> Vector2:
	if p.y >= WALL_Y:
		return p.clamp(WALL_MIN, WALL_MAX)
	return p.clamp(FIELD_MIN, FIELD_MAX)
