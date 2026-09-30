class_name Player
extends Node2D
## Принц: прямое управление в духе souls-like — выносливость, перекат с неуязвимостью,
## парирование, комбо и фляги, которые пьются долго и прерываются ударом.

const ATTACK_COST := 16.0
const ROLL_COST := 24.0
const PARRY_COST := 14.0
const ROLL_TIME := 0.36
const ROLL_SPEED := 175.0
const ROLL_IFRAMES := Vector2(0.03, 0.27)
const PARRY_WINDOW := 0.18
const PARRY_TIME := 0.5
const HEAL_TIME := 1.0
const HEAL_APPLY := 0.6
const HEAL_AMOUNT := 45.0
const HURT_TIME := 0.32
const HURT_IFRAMES := 0.25
const STAMINA_REGEN := 50.0
const STAMINA_DELAY := 0.55
const COMBO := [
	{"windup": 0.12, "active": 0.08, "recover": 0.26, "dmg": 20.0, "poise": 14.0, "reach": 24.0, "half": 1.2, "step": 40.0, "cost": 1.0},
	{"windup": 0.12, "active": 0.08, "recover": 0.26, "dmg": 20.0, "poise": 14.0, "reach": 24.0, "half": 1.2, "step": 40.0, "cost": 1.0},
	{"windup": 0.24, "active": 0.10, "recover": 0.42, "dmg": 34.0, "poise": 32.0, "reach": 28.0, "half": 1.4, "step": 70.0, "cost": 1.4},
]

var max_hp := 100.0
var hp := 100.0
var max_stamina := 100.0
var stamina := 100.0
var stamina_delay := 0.0
var speed := 72.0
var dmg_mult := 1.0
var max_flasks := 3
var flasks := 3
var facing := Vector2.DOWN
var state := "idle"
var state_t := 0.0
var combo := 0
var queued := false
var hit_set := {}
var roll_dir := Vector2.DOWN
var knock := Vector2.ZERO
var flash := 0.0
var healed := false


func reset_for_beacon(d: Dictionary) -> void:
	max_hp = 100.0 + 12.0 * int(d.vigor)
	max_stamina = 100.0 + 10.0 * int(d.endurance)
	dmg_mult = 1.0 + 0.12 * int(d.strength)
	max_flasks = 3 + int(d.flasks_extra)
	hp = max_hp
	stamina = max_stamina
	flasks = max_flasks
	combo = 0
	flash = 0.0
	_set_state("idle")


func is_invulnerable() -> bool:
	if state == "roll":
		return state_t >= ROLL_IFRAMES.x and state_t <= ROLL_IFRAMES.y
	return state == "hurt" and state_t < HURT_IFRAMES


func _set_state(s: String) -> void:
	state = s
	state_t = 0.0


func _spend(cost: float) -> void:
	stamina -= cost
	stamina_delay = STAMINA_DELAY


## Один шаг симуляции. `inp` — буфер ввода: move (Vector2) и оставшееся время буфера для кнопок.
func tick(dt: float, inp: Dictionary, game) -> void:
	state_t += dt
	flash = maxf(0.0, flash - dt)
	stamina_delay -= dt
	if state == "dead":
		queue_redraw()
		return
	if stamina_delay <= 0.0 and state != "roll" and state != "attack":
		stamina = minf(max_stamina, stamina + STAMINA_REGEN * (0.4 if state == "heal" else 1.0) * dt)
	var mv: Vector2 = inp.move
	match state:
		"idle":
			if mv.length() > 0.1:
				facing = mv.normalized()
				position += mv.limit_length(1.0) * speed * dt
			_try_actions(inp, game)
		"attack":
			var a: Dictionary = COMBO[combo]
			if inp.attack > 0.0 and combo < COMBO.size() - 1:
				queued = true
				inp.attack = 0.0
			if state_t < a.windup:
				position += facing * a.step * dt
			elif state_t < a.windup + a.active:
				game.player_strike(self, a)
			if state_t >= a.windup + a.active and inp.roll > 0.0 and stamina > 0.0:
				_start_roll(inp)
			elif state_t >= a.windup + a.active + a.recover:
				if queued and stamina > 0.0:
					_start_attack(combo + 1, game)
				else:
					combo = 0
					_set_state("idle")
		"roll":
			position += roll_dir * ROLL_SPEED * (1.0 - 0.5 * state_t / ROLL_TIME) * dt
			if state_t >= ROLL_TIME:
				_set_state("idle")
				_try_actions(inp, game)
		"parry":
			if state_t >= PARRY_TIME:
				_set_state("idle")
		"heal":
			position += mv.limit_length(1.0) * speed * 0.3 * dt
			if not healed and state_t >= HEAL_APPLY:
				healed = true
				hp = minf(max_hp, hp + HEAL_AMOUNT)
			if state_t >= HEAL_TIME:
				_set_state("idle")
		"hurt":
			position += knock * dt
			knock = knock.move_toward(Vector2.ZERO, 400.0 * dt)
			if state_t >= HURT_TIME:
				_set_state("idle")
	position = position.clamp(Combat.ARENA_MIN, Combat.ARENA_MAX)
	queue_redraw()


func _try_actions(inp: Dictionary, game) -> void:
	if stamina > 0.0:
		if inp.roll > 0.0:
			_start_roll(inp)
			return
		if inp.attack > 0.0:
			inp.attack = 0.0
			_start_attack(0, game)
			return
		if inp.parry > 0.0:
			inp.parry = 0.0
			_spend(PARRY_COST)
			_set_state("parry")
			return
	if inp.heal > 0.0 and flasks > 0:
		inp.heal = 0.0
		flasks -= 1
		healed = false
		_set_state("heal")


func _start_roll(inp: Dictionary) -> void:
	inp.roll = 0.0
	_spend(ROLL_COST)
	var mv: Vector2 = inp.move
	roll_dir = mv.normalized() if mv.length() > 0.1 else facing
	facing = roll_dir
	combo = 0
	queued = false
	_set_state("roll")


func _start_attack(i: int, game) -> void:
	combo = i
	queued = false
	hit_set.clear()
	_spend(ATTACK_COST * COMBO[i].cost)
	var e = game.nearest_enemy(position, 40.0)
	if e:
		facing = (e.position - position).normalized()
	_set_state("attack")


## Результат: "parried", "dodged", "hit" или "none".
func take_hit(dmg: float, from: Vector2, parryable: bool) -> String:
	if state == "dead":
		return "none"
	if parryable and state == "parry" and state_t <= PARRY_WINDOW:
		stamina = minf(max_stamina, stamina + PARRY_COST)
		return "parried"
	if is_invulnerable():
		return "dodged"
	hp -= dmg
	flash = 0.15
	combo = 0
	queued = false
	var d := position - from
	knock = (d.normalized() if d.length() > 0.01 else -facing) * 110.0
	if hp <= 0.0:
		hp = 0.0
		_set_state("dead")
	else:
		_set_state("hurt")
	return "hit"


func _draw() -> void:
	draw_rect(Rect2(-4, -1, 8, 2), Color(0, 0, 0, 0.35))
	var t := Sprites.tex("prince", flash > 0.0)
	if state == "dead":
		draw_set_transform(Vector2(0, -3), PI / 2.0, Vector2.ONE)
		Sprites.draw(self, Sprites.tex("prince"), Vector2(0, 6), false, Vector2.ONE, Color(0.55, 0.5, 0.5))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		return
	var mod := Color(1, 1, 1, 0.55) if state == "roll" and is_invulnerable() else Color.WHITE
	var sc := Vector2(1.0, 0.7) if state == "roll" else Vector2.ONE
	Sprites.draw(self, t, Vector2.ZERO, facing.x < 0.0, sc, mod)
	var ang := facing.angle()
	if state == "attack":
		var a: Dictionary = COMBO[combo]
		if state_t >= a.windup and state_t < a.windup + a.active + 0.05:
			draw_arc(Vector2(0, -5), a.reach - 4.0, ang - a.half, ang + a.half, 12, Color(1, 1, 1, 0.9), 2.0)
	elif state == "parry" and state_t <= PARRY_WINDOW:
		draw_arc(Vector2(0, -6), 10.0, ang - 1.0, ang + 1.0, 8, Color("73eff7"), 2.0)
	elif state == "heal":
		draw_circle(Vector2(0, -6), 6.0 + sin(state_t * 20.0), Color("ef7d57", 0.3))
