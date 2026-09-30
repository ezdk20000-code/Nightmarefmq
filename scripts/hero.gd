class_name Hero
extends Node2D
## Герой гарнизона. Игрок не управляет им напрямую — только отдаёт приказы:
## куда встать и когда применить способность. Герой в движении не атакует. Смерть необратима.

const RARITY := [
	{"id": "N", "mult": 1.0, "color": Color("9aa0a6"), "weight": 60},
	{"id": "R", "mult": 1.3, "color": Color("4fa3ff"), "weight": 28},
	{"id": "SR", "mult": 1.7, "color": Color("c77dff"), "weight": 10},
	{"id": "SSR", "mult": 2.3, "color": Color("ffc93c"), "weight": 2},
]
const MAX_LEVEL := 10

static var CLASSES := {
	"knight": {
		"name": "Рыцарь", "sprite": "knight", "hp": 160.0, "dmg": 14.0, "range": 16.0, "rate": 1.0,
		"speed": 40.0, "poise": 20.0,
		"ability": "taunt", "ab_name": "Вызов", "ab_cd": 18.0, "targeted": false,
		"ab_desc": "Враги рядом бьют только рыцаря 4 с, урон по нему −50%",
	},
	"archer": {
		"name": "Лучник", "sprite": "archer", "hp": 70.0, "dmg": 9.0, "range": 110.0, "rate": 0.9,
		"speed": 46.0, "poise": 3.0,
		"ability": "volley", "ab_name": "Залп", "ab_cd": 15.0, "targeted": true, "ab_radius": 30.0,
		"ab_desc": "Град стрел по области",
	},
	"mage": {
		"name": "Маг", "sprite": "mage", "hp": 60.0, "dmg": 18.0, "range": 90.0, "rate": 2.0,
		"speed": 36.0, "poise": 8.0, "splash": 16.0,
		"ability": "firerain", "ab_name": "Огненный дождь", "ab_cd": 25.0, "targeted": true, "ab_radius": 36.0,
		"ab_desc": "Огромный урон по области через 1 с. Задевает и своих!",
	},
	"priest": {
		"name": "Жрица", "sprite": "priest", "hp": 80.0, "dmg": 4.0, "range": 80.0, "rate": 2.0,
		"speed": 40.0, "poise": 2.0, "heal": 12.0,
		"ability": "prayer", "ab_name": "Молитва", "ab_cd": 30.0, "targeted": false,
		"ab_desc": "Лечит всех героев",
	},
}

## Ссылка на запись в Save.data.roster: изменения сразу попадают в сохранение.
var data: Dictionary = {}
var cls: Dictionary = {}
var hp := 1.0
var max_hp := 1.0
var path: Array = []
var cd := 0.0
var ab_cd := 0.0
var taunt_t := 0.0
var flash := 0.0
var anim := 0.0
var facing := 1.0
var dead := false
var selected := false


static func mult_for(d: Dictionary) -> float:
	return RARITY[int(d.rarity)].mult * (1.0 + 0.1 * (int(d.lvl) - 1))


static func max_hp_for(d: Dictionary) -> float:
	return CLASSES[d.cls].hp * mult_for(d)


func setup(d: Dictionary) -> void:
	data = d
	cls = CLASSES[d.cls]
	max_hp = max_hp_for(d)
	hp = max_hp if d.get("hp") == null else minf(float(d.hp), max_hp)


func mult() -> float:
	return mult_for(data)


func dmg() -> float:
	return cls.dmg * mult()


func on_wall() -> bool:
	return position.y >= Combat.WALL_Y


## Со стены стрелки и маги бьют дальше.
func attack_range() -> float:
	var r: float = cls.range
	if on_wall() and r > 40.0:
		r *= 1.25
	return r


func is_moving() -> bool:
	return not path.is_empty()


func rarity_color() -> Color:
	return RARITY[int(data.rarity)].color


func order_move(target: Vector2) -> void:
	var p := Combat.clamp_order(target)
	path.clear()
	if (p.y >= Combat.WALL_Y) != on_wall():
		path.append(Combat.GATE_WAY)
	path.append(p)


func tick(dt: float, game) -> void:
	if dead:
		return
	cd -= dt
	ab_cd = maxf(0.0, ab_cd - dt)
	taunt_t = maxf(0.0, taunt_t - dt)
	flash = maxf(0.0, flash - dt)
	anim = maxf(0.0, anim - dt)
	if not path.is_empty():
		var to: Vector2 = path[0] - position
		var step: float = cls.speed * dt
		if absf(to.x) > 0.1:
			facing = signf(to.x)
		if to.length() <= step:
			position = path.pop_front()
		else:
			position += to.normalized() * step
		queue_redraw()
		return
	if cd <= 0.0:
		_act(game)
	queue_redraw()


func _act(game) -> void:
	if data.cls == "priest":
		var ally = game.most_wounded_hero(position, attack_range(), 8.0)
		if ally:
			ally.heal(cls.heal * mult())
			game.heal_fx(ally)
			cd = cls.rate
			anim = 0.2
			return
	var e = game.enemy_for_hero(self)
	if e == null:
		return
	if absf(e.position.x - position.x) > 0.5:
		facing = signf(e.position.x - position.x)
	cd = cls.rate
	anim = 0.15
	if data.cls == "knight":
		e.take_damage(dmg(), cls.poise, game, self)
		game.slash_fx(e.position, facing)
	else:
		game.hero_projectile(self, e, dmg(), cls.get("splash", 0.0))


func take_damage(amount: float, game) -> void:
	if dead:
		return
	if taunt_t > 0.0:
		amount *= 0.5
	hp -= amount
	flash = 0.12
	game.floater(position + Vector2(0, -16), str(int(amount)), Color("e43b44"))
	if hp <= 0.0:
		hp = 0.0
		dead = true
		game.on_hero_died(self)


func heal(amount: float) -> void:
	if not dead:
		hp = minf(max_hp, hp + amount)


func gain_xp(x: int, game) -> void:
	data.xp = int(data.xp) + x
	data.kills = int(data.get("kills", 0)) + 1
	while int(data.lvl) < MAX_LEVEL and int(data.xp) >= int(data.lvl) * 10:
		data.xp = int(data.xp) - int(data.lvl) * 10
		level_up()
		game.floater(position + Vector2(0, -22), "УРОВЕНЬ %d" % int(data.lvl), Color("7ee081"))


func level_up() -> void:
	var ratio := hp / max_hp
	data.lvl = int(data.lvl) + 1
	max_hp = max_hp_for(data)
	hp = max_hp * ratio


func _draw() -> void:
	var rc := rarity_color()
	if selected:
		draw_arc(Vector2(0, 0), 7.0, 0.0, TAU, 16, Color("ffcd75"), 1.0)
	draw_rect(Rect2(-4, -1, 8, 2), Color(0, 0, 0, 0.35))
	draw_rect(Rect2(-3, 0, 6, 1), rc)
	if taunt_t > 0.0:
		draw_circle(Vector2(0, -6), 9.0 + sin(taunt_t * 12.0), Color("e43b44", 0.18))
	var lunge := Vector2(facing, 0) if anim > 0.0 else Vector2.ZERO
	Sprites.draw(self, Sprites.tex(cls.sprite, flash > 0.0), lunge, facing < 0.0)
	if hp < max_hp:
		draw_rect(Rect2(-5, -15, 10, 2), Color("1a1c2c"))
		draw_rect(Rect2(-5, -15, 10.0 * hp / max_hp, 1), Color("7ee081") if hp > max_hp * 0.35 else Color("e43b44"))
