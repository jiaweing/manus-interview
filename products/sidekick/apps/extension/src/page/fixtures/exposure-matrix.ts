export interface ExposureCase {
	kind: string;
	nativeSkipped?: boolean;
	wrap: (content: string) => string;
}

function attributes(kind: string, value: string): ExposureCase {
	return {
		kind,
		wrap: (content) =>
			`<section id='private-source' ${value}>${content}</section>`,
	};
}

const cssCases = [
	"display:none",
	"visibility:hidden",
	"visibility:collapse",
	"content-visibility:hidden",
	"opacity:0",
];
const hiddenCases = [
	"hidden",
	"hidden='hidden'",
	"hidden='false'",
	"hidden=' until-found '",
	"hidden='\tuntil-found\n'",
	"inert",
	"inert='false'",
];

/** Deterministic PRNG: randomized case/whitespace/nesting, reproducible in both engines. */
function randomVariants(): ExposureCase[] {
	let seed = 0x82_f0_0d;
	const next = () => {
		seed = (seed * 1_664_525 + 1_013_904_223) % 0x1_00_00_00_00;
		return seed / 0x1_00_00_00_00;
	};
	const spaces = ["", " ", "\t", "\r\n", " \t\n "];
	const randomCase = (text: string) =>
		Array.from(text, (char) =>
			next() < 0.5 ? char.toUpperCase() : char.toLowerCase()
		).join("");
	return Array.from({ length: 64 }, (_, index) => {
		const name = randomCase("aria-hidden");
		const value = `${spaces[Math.floor(next() * spaces.length)]}${randomCase("true")}${spaces[Math.floor(next() * spaces.length)]}`;
		const combination = index % 4;
		return {
			kind: `fuzz-${index}-${JSON.stringify({ combination, name, value })}`,
			wrap: (content) => {
				const hidden = `<section id='private-source' ${name}='${value}'><div aria-hidden='false' style='visibility:visible'>${content}</div></section>`;
				if (combination === 1) {
					return `<details><summary>Permitted summary</summary>${hidden}</details>`;
				}
				if (combination === 2) {
					return `<div inert><details open><summary>Permitted nested summary</summary>${hidden}</details></div>`;
				}
				return combination === 3
					? `<div style='content-visibility:hidden'>${hidden}</div>`
					: hidden;
			},
		};
	});
}

export const exposureCases: ExposureCase[] = [
	...cssCases.map((style) =>
		attributes(style, `style='${style};width:600px;height:60px'`)
	),
	...hiddenCases.map((attr) =>
		attributes(attr, `${attr} style='display:block;content-visibility:visible'`)
	),
	...["true", "TRUE", "True", " true ", "\tTrUe\r\n"].map((value) =>
		attributes(`aria-hidden ${JSON.stringify(value)}`, `aria-hidden='${value}'`)
	),
	...["template", "noscript", "script", "style", "datalist"].map((tag) => ({
		kind: tag,
		wrap: (content: string) =>
			`<${tag} id='private-source'>${content}</${tag}>`,
	})),
	{
		kind: "closed dialog",
		wrap: (content) =>
			`<dialog id='private-source' style='display:block'>${content}</dialog>`,
	},
	{
		kind: "closed details direct text and descendants",
		wrap: (content) =>
			`<details id='private-source'><summary>Permitted summary <span>Permitted summary child</span></summary>${content}</details>`,
	},
	{
		kind: "closed details without summary",
		wrap: (content) => `<details id='private-source'>${content}</details>`,
	},
	{
		kind: "closed details second summary",
		wrap: (content) =>
			`<details id='private-source'><summary>Permitted summary</summary><summary>${content}</summary></details>`,
	},
	{
		kind: "closed details nested open summary",
		wrap: (content) =>
			`<details><summary>Permitted summary</summary><details open id='private-source'><summary>${content}</summary></details></details>`,
	},
	attributes(
		"hidden until-found native unrevealed content",
		"hidden='until-found'"
	),
	{
		kind: "hidden until-found unrevealed content",
		wrap: (content) =>
			`<section id='private-source' hidden='until-found' style='content-visibility:hidden'>${content}</section>`,
	},
	{
		kind: "native checkVisibility auto-skipped",
		nativeSkipped: true,
		wrap: (content) =>
			`<section style='content-visibility:auto;contain-intrinsic-size:600px 60px;margin-top:20000px'><div id='private-source'>${content}</div></section>`,
	},
	...randomVariants(),
];

export function exposureFixture(entry: ExposureCase, sentinel: string): string {
	const privateContent = `${sentinel}<span>${sentinel}</span><label id='private-label' for='outside'>${sentinel}</label><span id='private-description'>${sentinel}</span><h2 aria-label='${sentinel}'>${sentinel}</h2><button type='button' aria-label='${sentinel}' title='${sentinel}'>${sentinel}</button><a href='/private/${sentinel}'>${sentinel}</a>`;
	const mixedHidden = entry
		.wrap(`<span>${sentinel}</span>`)
		.replaceAll("id='private-source'", "id='mixed-hidden'");
	return `<h1>Permitted heading</h1><button type='button' aria-labelledby='private-source private-label'>Permitted fallback</button><input id='outside'><button type='button' aria-describedby='private-source private-description'></button><span id='mixed-reference'>Permitted mixed name ${mixedHidden}</span><button type='button' aria-labelledby='mixed-reference'>Mixed fallback</button>${entry.wrap(privateContent)}<p>Permitted footer</p>`;
}

export const exposedPositiveFixture = `<h1>Permitted heading</h1><details><summary>Visible closed summary <button type='button'>Visible summary control</button></summary>Hidden body</details><details open><summary>Visible open summary</summary>Visible open body <button type='button'>Visible open control</button></details><dialog open style='display:block'>Visible dialog body <button type='button'>Visible dialog control</button></dialog><section hidden='until-found' style='content-visibility:visible'>Visible until-found override <button type='button'>Visible until-found control</button></section><p aria-hidden=' false '>Visible false aria-hidden</p><span id='visible-description'>Visible description</span><button type='button' aria-describedby='visible-description'></button>`;
