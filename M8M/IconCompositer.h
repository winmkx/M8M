/*
 * This code is released under the MIT license.
 * For conditions of distribution and use, see the LICENSE or hit the web.
 */
#pragma once
#include "M8MIcon.h"
#include "../Common/AREN/ArenDataTypes.h"
#include <utility>
#include <string>
#include <array>

/*! An IconCompositer takes a set of icons (expressed as 4D aubyte arrays) identified by name.
All icons must have the same size and a "compositing rectangle". For the time being the compositing rectangle
must be the same across all icons.

The IconCompositer keeps track of the current icon and a "state" represented by a color and a string.
This color is blended <b>below</b> the icon for all pixels in the compositing rectangle.
IconCompositer does not care about endianess, color format or whatever. It just pulls arrays of aubyte values
and multiplies/sets them by the various parameters, assuming everything will be coherent.
So it could be all RGBA or all ARGB, it doesn't care. All values are assumed to be sequentially tightly packed. 

It's a nice little stupid helper struct for the time being, only aubyte is going to work.
*/
template<asizei WIDTH, asizei HEIGHT>
class IconCompositer {
public:
	const aushort alphaIndex;
	explicit IconCompositer(aushort alphaChannelIndex = 3)
		: alphaIndex(alphaChannelIndex), hsx(0), hsy(0), hsWidth(0), hsHeight(0), activeIcon(0), activeState(0) { }
	std::pair<asizei, asizei> GetIconDimensions() const { return std::make_pair(WIDTH, HEIGHT); }
	void AddIcon(const char *name, const aubyte *values) { icons.push_back(Icon(name, values)); }
	void SetCurrentIcon(const char *name) {
		for(asizei loop = 0; loop < icons.size(); loop++) {
			if(strcmp(icons[loop].name, name) == 0) {
				activeIcon = loop;
				return;
			}
		}
		throw std::string("No icon named \"") + name + "\"";
	}
	void AddState(const char *name, const aubyte *pixel) { states.push_back(StateDecoration(name, pixel)); }
	void SetCurrentState(const char *name) {
		for(asizei loop = 0; loop < states.size(); loop++) {
			if(strcmp(states[loop].name, name) == 0) {
				activeState = loop;
				return;
			}
		}
		throw std::string("No state named \"") + name + "\"";
	}
	void SetIconHotspot(asizei x, asizei y, asizei w, asizei h) {
		hsx = x;
		hsy = y;
		hsWidth = w;
		hsHeight = h;
	}
	void GetCompositedIcon(aubyte *buffer) const {
		const asingle scale = 1.0f / 255.0f;
		asizei off = 0;
		for(asizei row = 0; row < HEIGHT; row++) {
			for(asizei col = 0; col < WIDTH; col++) { // copy to buffer and premultiply
				aubyte *dst = buffer + off;
				const aubyte *src = icons[activeIcon].pixels + off;
				off += 4;
				const asingle srcAlpha = src[alphaIndex] * scale;
				for(asizei c = 0; c < 4; c++) {
					asingle mult = src[c] * scale * (c == 3? 1.0f : srcAlpha);
					dst[c] = aubyte(mult * 255.0f);
				}
			}
		}

		asingle preColor[4];
		for(asizei cp = 0; cp < 4; cp++) {
			asingle mult = (cp != alphaIndex? states[activeState].pixel[cp] * scale : 1.0f);
			preColor[cp] = mult * (states[activeState].pixel[alphaIndex] * scale);
		}
		// "over" with premultiply is src*1+dst*(1-src_a)
		// "behind" with premultiply is src*(1-dst_a)+dst*1
		off = (hsy * WIDTH + hsx) * 4;
		for(asizei row = 0; row < hsHeight; row++) {
			for(asizei col = 0; col < hsWidth; col++) {
				const asingle dstAlpha = buffer[off + col * 4 + alphaIndex] * scale;
				for(asizei c = 0; c < 4; c++) {
					adouble mult = buffer[off + col * 4 + c] * scale * 1.0f;
					mult += preColor[c] * (1.0f - dstAlpha);
					buffer[off + col * 4 + c] = aubyte(mult * 255.0f);
				}
			}
			off += WIDTH * 4;
		}
	}
	void GetCompositedIcon(std::array<aubyte, WIDTH * HEIGHT * 4> &ico) const {
		GetCompositedIcon(ico.data());
	}

private:
	asizei hsx, hsy;
	asizei hsWidth, hsHeight;
	asizei activeIcon, activeState;

	struct Icon {
		const char *name;
		const aubyte *pixels;
		explicit Icon() { }
		Icon(const char *n, const aubyte *p) : name(n), pixels(p) { }
	};
	struct StateDecoration {
		const char *name;
		const aubyte *pixel;
		explicit StateDecoration() : name(nullptr), pixel(nullptr) { }
		StateDecoration(const char *n, const aubyte *p) : name(n), pixel(p) { }
	};
	std::vector<Icon> icons;
	std::vector<StateDecoration> states;
};

