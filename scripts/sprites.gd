class_name Sprites
## Пиксельные спрайты-заглушки, собранные из строк. Позже заменим на настоящий арт.

static var PAL := {
	"k": Color("1a1c2c"), "a": Color("b8c4d6"), "A": Color("6d7a91"), "c": Color("b13e53"),
	"y": Color("ffcd75"), "w": Color("e8e8e8"), "u": Color("6b8f8a"), "e": Color("a7f070"),
	"r": Color("3d4a4f"), "n": Color("8b9bb4"), "N": Color("566c86"), "G": Color("8a7a55"),
	"d": Color("5d3a2a"), "b": Color("8a5a2b"), "g": Color("38b764"), "s": Color("f4c29a"),
	"p": Color("5d275d"), "P": Color("b55088"), "o": Color("ef7d57"), "f": Color("1e6b44"),
}

static var DATA := {
	"knight": [
		"..kkkkk..",
		".kaaaaak.",
		".kaAkAak.",
		".kaaaaak.",
		"..kcaak.w",
		".kaaaaakw",
		"kcaaaaakw",
		"kcaAAaakk",
		".kaaaaak.",
		".kak.kak.",
		".kk...kk.",
	],
	"archer": [
		"...kkk.b.",
		"..kgggkbw",
		".kgsssgkw",
		".kgkskgkw",
		"..kssskbw",
		".kfggggkb",
		"kfgggggkb",
		"kfgffgk..",
		".kgggggk.",
		".kbk.kbk.",
		".kk...kk.",
	],
	"mage": [
		"....k...o",
		"...kPk.oy",
		"..kPPPk.b",
		".kPPPPPkb",
		"kkkkkkkkb",
		".kssssk.b",
		".kskskk.b",
		"..kssk..b",
		".kpppppkb",
		"kpppppppk",
		".kkkkkkk.",
	],
	"priest": [
		"...kkk...",
		"..kwwwk..",
		".kwsssk..",
		".kwkskk..",
		"..kssk.y.",
		".kwwwwkyk",
		"kwwywwkyk",
		"kwwywwk.y",
		".kwwwwk..",
		".kwwwwwk.",
		".kkkkkkk.",
	],
	"spitter": [
		"..kkkkk..",
		".kPPPPPk.",
		"kPePPPePk",
		"kPPPPPPPk",
		"kPPkkkPPk",
		".kPPPPPk.",
		"kPPPPPPPk",
		".kPk.kPk.",
		".kk...kk.",
	],
	"husk": [
		"..kkkk...",
		".kuuuuk..",
		".kueuek..",
		".kuuuuk..",
		"..kuuk...",
		".krrrrk..",
		"kurrrruk.",
		"ku.rr.uk.",
		".krrrrk..",
		".kr..rk..",
		".kk..kk..",
	],
	"hound": [
		"........kk.",
		"k......knnk",
		"kk....knnek",
		".knnnnnnnnk",
		".knNnnnNnk.",
		".kn.k.kn...",
		".k..k.k....",
	],
	"spear": [
		"........w.",
		".......kwk",
		"..kkkk..b.",
		".kGGGGk.b.",
		".kGeeGk.b.",
		".kGGGGk.b.",
		"kdddddddb.",
		"kdGdddGdb.",
		".kdddddkb.",
		".kd...dkb.",
		".kk...kk..",
	],
	"lord": [
		"...y..y..y..y...",
		"...yyyyyyyyyy...",
		"..kuuuuuuuuuuk..",
		".kuueeuuuueeuuk.",
		".kuuuuuuuuuuuuk.",
		".kuuukkkkkkuuuk.",
		"..kuuuuuuuuuuk..",
		".krrrrrrrrrrrrk.",
		"kurrrrrrrrrrrruk",
		"kuurrrryyrrrruuk",
		"kuurrrrrrrrrrruk",
		".kkrrrrrrrrrrkk.",
		"..krrrrrrrrrrk..",
		"..krrr.kk.rrrk..",
		"..krr..kk..rrk..",
		"..kkk......kkk..",
	],
	"tower_archer": [
		"..kkk..",
		".kgggk.",
		".kgsgkb",
		"..kgkbw",
		".kgggkb",
		".kg.gk.",
		".kk.kk.",
	],
}

static var _cache := {}


static func tex(name: String, white: bool = false) -> Texture2D:
	var key := name + ("#w" if white else "")
	if _cache.has(key):
		return _cache[key]
	var rows: Array = DATA[name]
	var first: String = rows[0]
	var img := Image.create(first.length(), rows.size(), false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	for y in rows.size():
		var row: String = rows[y]
		for x in row.length():
			var ch := row[x]
			if ch == ".":
				continue
			img.set_pixel(x, y, Color.WHITE if white else PAL.get(ch, Color.MAGENTA))
	var t := ImageTexture.create_from_image(img)
	_cache[key] = t
	return t


## Рисует спрайт так, что `feet` — точка под ногами.
static func draw(ci: CanvasItem, t: Texture2D, feet: Vector2, flip: bool = false, scale: Vector2 = Vector2.ONE, mod: Color = Color.WHITE) -> void:
	var s := t.get_size() * scale
	var r := Rect2(Vector2(floorf(feet.x - s.x / 2.0), floorf(feet.y - s.y)), s)
	if flip:
		ci.draw_set_transform(Vector2(feet.x * 2.0, 0.0), 0.0, Vector2(-1, 1))
		ci.draw_texture_rect(t, r, false, mod)
		ci.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	else:
		ci.draw_texture_rect(t, r, false, mod)
