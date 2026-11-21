const text = { minLength: 1, pattern: "\\S", type: "string" };
// Display declarations may contain internal spaces, but not surrounding whitespace.
const declarationText = {
	minLength: 1,
	pattern: "^\\S(?:[\\s\\S]*\\S)?$",
	type: "string",
};
const platform = { pattern: "^[a-z][a-z0-9._-]*$", type: "string" };
const permission = { pattern: "^[a-z][a-z0-9._:-]*$", type: "string" };
const permissionList = { items: permission, type: "array", uniqueItems: true };
const capability = {
	additionalProperties: false,
	properties: {
		description: declarationText,
		input_schema: { type: "object" },
		name: { pattern: "^[a-z][a-z0-9._-]*(?:@[1-9][0-9]*)?$", type: "string" },
		required_permissions: permissionList,
		rpc_method: { pattern: "^[a-zA-Z][a-zA-Z0-9._/-]*$", type: "string" },
	},
	required: [
		"name",
		"description",
		"input_schema",
		"rpc_method",
		"required_permissions",
	],
	type: "object",
};

/** Host schema is strict; plugin schemas are compiled separately by Ajv. */
export const manifestSchema = {
	additionalProperties: false,
	properties: {
		config: {
			additionalProperties: false,
			properties: { defaults: { type: "object" }, schema: { type: "object" } },
			required: ["schema", "defaults"],
			type: "object",
		},
		id: { pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$", type: "string" },
		manifest_version: { type: "integer" },
		min_host_version: text,
		name: declarationText,
		permissions: permissionList,
		platforms: {
			items: platform,
			minItems: 1,
			type: "array",
			uniqueItems: true,
		},
		providers: { items: capability, type: "array" },
		runtime: {
			additionalProperties: false,
			properties: { argv: { items: text, minItems: 1, type: "array" } },
			required: ["argv"],
			type: "object",
		},
		tools: { items: capability, type: "array" },
		version: text,
	},
	required: [
		"manifest_version",
		"id",
		"name",
		"version",
		"min_host_version",
		"platforms",
		"runtime",
		"permissions",
		"config",
	],
	type: "object",
};
