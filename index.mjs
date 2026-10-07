import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
//#region src/capture.ts
const CONVERSATION_SOURCE_KINDS = new Set([
	"user",
	"model",
	"tool"
]);
/**
* Request-message roles outside the editor's three-role model render as the
* user-role context they are; only an assistant message keeps its own role.
*/
function capturedRole(message) {
	if (message.role === "assistant") return "assistant";
	return message.role === "system" ? "system" : "user";
}
/** The producer metadata of one request message, or undefined for identity-free user input. */
function sourceRecord(message) {
	if (message.source === void 0) return void 0;
	return structuredClone(message.source);
}
function blockText(block) {
	const record = block;
	if ((block.type === "text" || block.type === "reasoning") && typeof record["text"] === "string") return record["text"];
	return JSON.stringify(block, null, 2);
}
function renderMessageContent(message) {
	return message.content.map(blockText).join("\n\n");
}
function instructionResources(source) {
	if (source["form"] !== "instructions" || !Array.isArray(source["changes"])) return [];
	const resources = [];
	for (const change of source["changes"]) {
		if (typeof change !== "object" || change === null || Array.isArray(change)) continue;
		const record = change;
		const action = record["action"];
		const path = record["path"];
		const digest = record["digest"];
		if (action !== "set" && action !== "replace" && action !== "remove" || typeof path !== "string") continue;
		resources.push({
			id: `resource:${String(resources.length)}`,
			path,
			action,
			...typeof digest === "string" ? { digest } : {},
			editable: action !== "remove" && typeof digest === "string"
		});
	}
	return resources;
}
/** Whether one request message carries producer-owned context rather than conversation. */
function isInjectedContextMessage(message) {
	const source = sourceRecord(message);
	if (source === void 0) return false;
	const kind = source["kind"];
	return typeof kind === "string" && !CONVERSATION_SOURCE_KINDS.has(kind);
}
/** Capture every producer-owned context message without knowing its plugin kind in advance. */
function captureInjectedMessages(messages) {
	return messages.flatMap((message, order) => {
		const source = sourceRecord(message);
		if (source === void 0 || !isInjectedContextMessage(message)) return [];
		const sourceKind = String(source["kind"]);
		const plugin = source["plugin"];
		const form = source["form"];
		const summary = source["summary"];
		return [{
			id: `captured:${String(message.id)}`,
			kind: "captured",
			role: capturedRole(message),
			order,
			enabled: true,
			template: renderMessageContent(message),
			messageId: String(message.id),
			sourceKind,
			producer: typeof plugin === "string" ? plugin : sourceKind,
			...typeof form === "string" ? { form } : {},
			...typeof summary === "string" ? { summary } : {},
			source,
			resources: instructionResources(source)
		}];
	});
}
/** Describe the unmodified request gaps used by supplement placement. */
function requestLayout(messages) {
	let userAnchor = null;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "user" && message.source?.kind === "user") {
			userAnchor = index;
			break;
		}
	}
	return {
		messageCount: messages.length,
		userAnchor
	};
}
//#endregion
//#region src/resource.ts
/** Resolution and exact replacement of source-declared instruction files. */
var CapturedResourceNotFoundError = class extends Error {};
var CapturedResourceConflictError = class extends Error {};
function sha1(content) {
	return createHash("sha1").update(content).digest("hex");
}
function ancestorDirectories(cwd) {
	const directories = [];
	let current = resolve(cwd);
	for (;;) {
		directories.push(current);
		const parent = dirname(current);
		if (parent === current) return directories;
		current = parent;
	}
}
function fixedPath(displayPath) {
	if (isAbsolute(displayPath)) return resolve(displayPath);
	if (displayPath.startsWith("$DSH_HOME/")) {
		const dshHome = process.env["DSH_HOME"];
		return dshHome === void 0 ? void 0 : join(dshHome, displayPath.slice(10));
	}
	if (displayPath.startsWith("~/.dsh/")) return join(homedir(), ".dsh", displayPath.slice(7));
}
async function readable(path) {
	try {
		const content = await readFile(path, "utf8");
		return {
			path,
			content,
			digest: sha1(content)
		};
	} catch {
		return;
	}
}
function isReadableFile(file) {
	return file !== void 0;
}
async function resolveResource(cwd, resource) {
	const fixed = fixedPath(resource.path);
	if (fixed !== void 0) {
		const file = await readable(fixed);
		if (file !== void 0) return file;
		throw new CapturedResourceNotFoundError(`上下文文件不存在或不可读：${resource.path}`);
	}
	const candidates = ancestorDirectories(cwd).map((directory) => resolve(directory, resource.path));
	const readableCandidates = (await Promise.all(candidates.map(readable))).filter(isReadableFile);
	const matching = resource.digest === void 0 ? [] : readableCandidates.filter((file) => file.digest === resource.digest);
	if (matching.length === 1) return matching[0];
	if (matching.length > 1) throw new CapturedResourceConflictError(`上下文文件路径不唯一：${resource.path}`);
	if (readableCandidates.length === 1) return readableCandidates[0];
	if (readableCandidates.length > 1) throw new CapturedResourceConflictError(`上下文文件已变化且路径不唯一：${resource.path}`);
	throw new CapturedResourceNotFoundError(`无法从会话工作目录解析上下文文件：${resource.path}`);
}
/** Load the exact current file selected by one captured instructions transition. */
async function loadCapturedResource(cwd, resource) {
	const file = await resolveResource(cwd, resource);
	return {
		path: resource.path,
		content: file.content,
		digest: file.digest
	};
}
/** Replace the source file only if it still has the bytes loaded by the editor. */
async function saveCapturedResource(cwd, resource, content, expectedDigest) {
	const current = await resolveResource(cwd, resource);
	if (current.digest !== expectedDigest) throw new CapturedResourceConflictError(`上下文文件已在编辑期间变化：${resource.path}`);
	await writeFile(current.path, content, "utf8");
	return {
		path: resource.path,
		content,
		digest: sha1(content)
	};
}
//#endregion
//#region src/shared.ts
/** Settings namespace shared by the Host registration and browser editor. */
const PROMPT_STUDIO_NAMESPACE = "prompt-studio";
/** Same-origin endpoint exposing the runtime-discovered prompt inventory. */
const PROMPT_STUDIO_STATE_PATH = "/prompt-studio/state";
/** Same-origin endpoint owned by the plugin for its private settings namespace. */
const PROMPT_STUDIO_SETTINGS_PATH = "/prompt-studio/settings";
/** Same-origin endpoint for resources declared by captured context producers. */
const PROMPT_STUDIO_RESOURCE_PATH = "/prompt-studio/resource";
/** Conversation-view placement: Chat is 0 and Trajectory is 10. */
const PROMPT_STUDIO_VIEW_ORDER = 20;
/** Initial order assigned to a newly added supplement. */
const DEFAULT_SUPPLEMENT_ORDER = 100;
/** Namespace reserved for ordered replacement markers owned by the Host half. */
const PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX = "prompt-studio:override-marker:";
const KINDS = new Set(["native", "supplement"]);
const POSITIONS = new Set([
	"after_system",
	"anchored",
	"tail"
]);
const ROLES = new Set([
	"system",
	"user",
	"assistant"
]);
function validateIdentifier(value, label) {
	if (value.length === 0 || value.trim() !== value) throw new TypeError(`${label} must be non-empty and have no surrounding whitespace`);
}
/** Return whether a supplement targets one runtime-native component. */
function isNativeOverride(component) {
	return component.kind === "supplement" && component.origin !== void 0;
}
/**
* Validate configured or runtime component rows.
* @param components - rows to validate.
* @param allowNative - whether runtime-only native rows are accepted.
*/
function validatePromptComponents(components, allowNative = false) {
	const ids = /* @__PURE__ */ new Set();
	const overrideTargets = /* @__PURE__ */ new Set();
	for (const component of components) {
		validateIdentifier(component.id, "prompt component ids");
		if (!KINDS.has(component.kind)) throw new TypeError(`prompt component "${component.id}" has an invalid kind`);
		if (!ROLES.has(component.role)) throw new TypeError(`prompt component "${component.id}" has an invalid role`);
		if (component.role === "system") {
			if (component.position !== void 0) throw new TypeError(`system prompt component "${component.id}" cannot define a message position`);
		} else if (component.position === void 0 || !POSITIONS.has(component.position)) throw new TypeError(`message prompt component "${component.id}" has an invalid position`);
		if (component.blockType !== void 0) {
			if (component.blockType !== "text" && component.blockType !== "reasoning") throw new TypeError(`prompt component "${component.id}" has an invalid block type`);
			if (component.role !== "assistant") throw new TypeError(`prompt component "${component.id}" blockType applies only to assistant components`);
		}
		if (!Number.isFinite(component.order)) throw new TypeError(`prompt component "${component.id}" order must be a finite number`);
		if (component.id.startsWith("prompt-studio:override-marker:")) throw new TypeError(`prompt component ids beginning with "${PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX}" are reserved`);
		if (ids.has(component.id)) throw new TypeError(`prompt component "${component.id}" is listed more than once`);
		ids.add(component.id);
		if (component.kind === "native") {
			if (!allowNative) throw new TypeError(`native prompt component "${component.id}" cannot be persisted`);
			if (component.origin !== void 0) throw new TypeError(`native prompt component "${component.id}" cannot override another component`);
			if (component.role !== "system") throw new TypeError(`native prompt component "${component.id}" must use the system role`);
			continue;
		}
		if (component.origin === void 0) continue;
		validateIdentifier(component.origin, `supplement "${component.id}" native target`);
		if (overrideTargets.has(component.origin)) throw new TypeError(`native prompt component "${component.origin}" is overridden more than once`);
		overrideTargets.add(component.origin);
	}
}
function uniqueComponentId(preferred, used) {
	if (!used.has(preferred)) {
		used.add(preferred);
		return preferred;
	}
	for (let suffix = 2;; suffix += 1) {
		const candidate = `${preferred}-${String(suffix)}`;
		if (used.has(candidate)) continue;
		used.add(candidate);
		return candidate;
	}
}
/** Render one supplement as plain content without any wrapper markup. */
function renderSupplementBoundary(_id, text) {
	return text;
}
function systemPreviewComponent(component) {
	const snapshot = {
		...component,
		template: renderSupplementBoundary(component.id, component.template)
	};
	delete snapshot.position;
	return snapshot;
}
/** Resolve overrides and supplements for a draft of the single system slot. */
function buildDraftSystemComponents(native, configured) {
	validatePromptComponents(native, true);
	validatePromptComponents(configured);
	const nativeIds = new Set(native.map((component) => component.id));
	const overrides = new Map(configured.filter(isNativeOverride).map((component) => [component.origin, component]));
	const ordered = native.flatMap((component, declaration) => {
		if (overrides.get(component.id) === void 0) return component.enabled ? [{
			component: { ...component },
			declaration
		}] : [];
		return [];
	});
	for (const [declaration, component] of configured.entries()) {
		if (!component.enabled || component.role !== "system") continue;
		if (component.origin !== void 0 && !nativeIds.has(component.origin)) continue;
		ordered.push({
			component: systemPreviewComponent(component),
			declaration: native.length + declaration
		});
	}
	return ordered.sort((left, right) => left.component.order - right.component.order || left.declaration - right.declaration).map((entry) => entry.component);
}
/** Concatenate enabled system components using the Host renderer's blank-line rule. */
function renderSystemPreview(components) {
	return components.map((component) => component.template).filter((text) => text.length > 0).join("\n\n");
}
/** Allocate the first readable supplement id absent from a component draft. */
function nextSupplementId(components) {
	return uniqueComponentId("supplement:message", new Set(components.map((component) => component.id)));
}
/** Allocate a readable id for a supplement overriding one native component. */
function nextOverrideId(components, target) {
	const used = new Set(components.map((component) => component.id));
	return uniqueComponentId(`override:${target}`, used);
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Shared config references used by schema validators and plugin runtimes. */
const write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
	if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
	if (value === null || typeof value !== "object") return value;
	if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
		return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
	} finally {
		ancestors.delete(value);
	}
}
/**
* Create a detached reference containing an immutable copy of the supplied data.
* @param value - validated config data; class instances and functions are unsupported.
* @returns a reference whose value is updated only by its owning runtime.
*/
function createVolatile(value) {
	let current = snapshot(value);
	return Object.freeze({
		get: () => current,
		[write]: (value) => {
			current = value;
		}
	});
}
/**
* Identify references across ESM/CJS copies of the shared library.
* @param value - a parsed config value.
* @returns whether the value implements the shared reference protocol.
*/
function isVolatile(value) {
	return typeof value === "object" && value !== null && write in value;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/**
* Compare values recursively, treating two volatile references as equal regardless of value.
* Strict comparison distinguishes null/undefined, treats opaque objects by identity,
* compares URLs by normalized href, treats array holes as undefined, and considers distinct cyclic structures unequal.
* @param a - first value.
* @param b - second value.
* @param strict - whether to require strict data equality outside volatile references.
* @returns whether the values compare equal.
*/
function deepEqual(a, b, strict) {
	const ancestors = /* @__PURE__ */ new Set();
	function compare(a, b) {
		if (a === b) return true;
		if (isVolatile(a) || isVolatile(b)) return isVolatile(a) && isVolatile(b);
		if (!strict && isNullable(a) && isNullable(b)) return true;
		if (typeof a !== typeof b || typeof a !== "object" || !a || !b) return false;
		if (ancestors.has(a)) return false;
		function check(test, then) {
			return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
		}
		ancestors.add(a);
		try {
			return check(Array.isArray, (a, b) => {
				if (a.length !== b.length) return false;
				for (let index = 0; index < a.length; index++) if (!compare(a[index], b[index])) return false;
				return true;
			}) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("URL"), (a, b) => a.href === b.href) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
				if (a.byteLength !== b.byteLength) return false;
				const viewA = new Uint8Array(a);
				const viewB = new Uint8Array(b);
				for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
				return true;
			}) ?? ((!strict || [a, b].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
				...a,
				...b
			}).every((key) => compare(a[key], b[key])));
		} finally {
			ancestors.delete(a);
		}
	}
	return compare(a, b);
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.4/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (isVolatile(value)) value = value.get();
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.volatile = function volatile() {
	if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
	return this.extra("volatile", true);
};
const resolvers = {};
const checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
	const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
	if (states.has(blocked)) return;
	states.add(blocked);
	seen.set(schema, states);
	if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
	const nested = blocked || !!schema.meta?.volatile;
	if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
	if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
	if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
	if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (!options[checkedVolatile]) {
		validateVolatileSchema(schema, options.path);
		options = {
			...options,
			[checkedVolatile]: true
		};
	}
	if (schema.meta?.volatile) {
		const inner = Schema(schema);
		inner.meta = {
			...schema.meta,
			volatile: false
		};
		const [value, adapted] = Schema.resolve(data, inner, options, strict);
		try {
			return [createVolatile(value), adapted];
		} catch (error) {
			throw new ValidationError(error instanceof Error ? error.message : String(error), options);
		}
	}
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
		validateVolatileSchema(schema.inner, options.path, true);
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region src/config.ts
const finiteOrder = Schema.transform(Schema.number(), (value) => {
	if (!Number.isFinite(value)) throw new TypeError("prompt component order must be a finite number");
	return value;
}, true);
const kindSchema = Schema.union([Schema.const("native"), Schema.const("supplement")]);
const positionSchema = Schema.union([
	Schema.const("after_system"),
	Schema.const("anchored"),
	Schema.const("tail")
]);
const roleSchema = Schema.union([
	Schema.const("system"),
	Schema.const("user"),
	Schema.const("assistant")
]);
const blockTypeSchema = Schema.union([Schema.const("text"), Schema.const("reasoning")]);
const componentSchema = Schema.object({
	id: Schema.string().min(1),
	kind: kindSchema,
	role: roleSchema,
	position: positionSchema.default(void 0),
	order: finiteOrder,
	enabled: Schema.boolean().default(true),
	template: Schema.string(),
	origin: Schema.string().min(1).default(void 0),
	blockType: blockTypeSchema.default(void 0)
});
const uniqueComponents = Schema.transform(Schema.array(componentSchema), (components) => {
	const normalized = components.map((component) => {
		if (component.role !== "system") return component;
		if (component.position !== void 0 && component.position !== "after_system") return component;
		const snapshot = { ...component };
		delete snapshot.position;
		return snapshot;
	});
	validatePromptComponents(normalized);
	return normalized;
}, true);
/**
* Plugin Config schema. `components` is volatile so the settings service can
* edit the list in place and the running pipeline re-reads it without
* remounting the plugin fiber.
*/
const Config = Schema.object({ components: uniqueComponents.default([]).volatile() });
/** Persisted settings schema. Only user-authored supplements are stored. */
const studioConfigSchema = Config;
//#endregion
//#region src/index.ts
/** Branded Host settings key: the profile entry id declared by `cordis.patch.yml`. */
const PROMPT_STUDIO_SETTINGS_NAMESPACE = PROMPT_STUDIO_NAMESPACE;
/** Stable Cordis plugin name. */
const name = "client-ui-prompt-studio";
/** Host services required by the component and request pipelines. */
const inject = [
	"settings",
	"systemPrompt",
	"llm",
	"sessions"
];
const SYSTEM_SECTION_PREFIX = "prompt-studio:supplement-section:";
const SUPPLEMENT_CONTEXT_PREFIX = "prompt-studio:supplement-context:";
function markerName(target) {
	return `${PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX}${target}`;
}
function systemSectionName(id) {
	return `${SYSTEM_SECTION_PREFIX}${id}`;
}
function cloneComponent(component) {
	return { ...component };
}
/**
* Position bases for the runtime-context snapshot. DSH materializes every
* `systemPrompt.context()` contribution as one durable user-role context
* snapshot, so a message supplement's `position` selects its place in that
* ordered snapshot: `after_system` first, `anchored` and `tail` last.
*/
const SUPPLEMENT_POSITION_ORDER = {
	after_system: -1e3,
	anchored: 0,
	tail: 1e3
};
/**
* The runtime-context contribution of one enabled user/assistant supplement.
* DSH logs injected non-system content as producer-owned user-role context;
* a synthetic assistant turn is not a legal session event.
* @param component - the active message supplement.
* @returns the ordered context contribution.
*/
function supplementContext(component) {
	return {
		name: `${SUPPLEMENT_CONTEXT_PREFIX}${component.id}`,
		order: SUPPLEMENT_POSITION_ORDER[component.position ?? "tail"] + component.order,
		text: renderSupplementBoundary(component.id, component.template)
	};
}
/** Live values contributed by currently active configuration effects. */
var RuntimeBindings = class {
	ownedSectionNames = /* @__PURE__ */ new Set();
	overridesByMarker = /* @__PURE__ */ new Map();
	systemBySection = /* @__PURE__ */ new Map();
	/** Activate one component and return its composed inverse. */
	activate(ctx, component) {
		if (component.kind === "native") throw new TypeError(`native prompt component "${component.id}" cannot be activated from settings`);
		if (isNativeOverride(component)) {
			const snapshot = {
				...component,
				origin: component.origin
			};
			const marker = markerName(snapshot.origin);
			return ctx.effect(function* () {
				this.ownedSectionNames.add(marker);
				this.overridesByMarker.set(marker, snapshot);
				if (snapshot.enabled && snapshot.role === "system") this.systemBySection.set(marker, snapshot);
				yield () => {
					this.systemBySection.delete(marker);
					this.overridesByMarker.delete(marker);
					this.ownedSectionNames.delete(marker);
				};
				yield ctx.systemPrompt.section({
					name: marker,
					order: snapshot.order,
					text: snapshot.enabled && snapshot.role === "system" ? renderSupplementBoundary(snapshot.id, snapshot.template) : ""
				});
				if (snapshot.enabled && snapshot.role !== "system") yield ctx.systemPrompt.context(supplementContext(snapshot));
			}.bind(this), `prompt-studio: override ${snapshot.origin}`);
		}
		if (!component.enabled) return ctx.effect(() => () => void 0, `prompt-studio: disabled ${component.id}`);
		const snapshot = cloneComponent(component);
		if (snapshot.role === "system") {
			const sectionName = systemSectionName(snapshot.id);
			return ctx.effect(function* () {
				this.ownedSectionNames.add(sectionName);
				this.systemBySection.set(sectionName, snapshot);
				yield () => {
					this.systemBySection.delete(sectionName);
					this.ownedSectionNames.delete(sectionName);
				};
				yield ctx.systemPrompt.section({
					name: sectionName,
					order: snapshot.order,
					text: renderSupplementBoundary(snapshot.id, snapshot.template)
				});
			}.bind(this), `prompt-studio: system supplement ${component.id}`);
		}
		return ctx.effect(() => ctx.systemPrompt.context(supplementContext(snapshot)), `prompt-studio: supplement ${component.id}`);
	}
};
/** Replaces a complete configuration by recovering and reapplying one composed effect. */
var ComponentPipeline = class {
	ctx;
	bindings;
	recover = () => void 0;
	constructor(ctx, bindings) {
		this.ctx = ctx;
		this.bindings = bindings;
	}
	replace(components) {
		validatePromptComponents(components);
		this.recover();
		const snapshots = components.map(cloneComponent);
		this.recover = this.ctx.effect(function* () {
			for (const component of snapshots) yield this.bindings.activate(this.ctx, component);
		}.bind(this), "prompt-studio: configured component set");
	}
};
function applyOverrides(assembly, overridesByMarker) {
	const matchedOverrideIds = /* @__PURE__ */ new Set();
	if (overridesByMarker.size === 0) return matchedOverrideIds;
	const presentNames = new Set(assembly.sections.map((section) => section.name));
	const matchedMarkers = /* @__PURE__ */ new Set();
	const replacedTargets = /* @__PURE__ */ new Set();
	for (const [marker, override] of overridesByMarker) {
		if (!presentNames.has(marker) || !presentNames.has(override.origin)) continue;
		matchedMarkers.add(marker);
		replacedTargets.add(override.origin);
		matchedOverrideIds.add(override.id);
	}
	assembly.sections = assembly.sections.flatMap((section) => {
		const override = overridesByMarker.get(section.name);
		if (override !== void 0) return matchedMarkers.has(section.name) && override.enabled && override.role === "system" ? [section] : [];
		return replacedTargets.has(section.name) ? [] : [section];
	});
	return matchedOverrideIds;
}
function runtimeNative(sections, ownedSectionNames) {
	return sections.filter((section) => !ownedSectionNames.has(section.name)).map((section, order) => ({
		id: section.name,
		kind: "native",
		role: "system",
		order,
		enabled: true,
		template: section.text
	}));
}
function effectiveAssembly(sections, systemBySection) {
	return sections.map((section, order) => {
		const supplement = systemBySection.get(section.name);
		if (supplement !== void 0) {
			const snapshot = {
				...supplement,
				template: section.text
			};
			delete snapshot.position;
			return snapshot;
		}
		return {
			id: section.name,
			kind: "native",
			role: "system",
			order,
			enabled: true,
			template: section.text
		};
	});
}
/** Latest value-level snapshot of the runtime registry. */
var RuntimeCatalogStore = class {
	revision = 0;
	native = [];
	assembled = [];
	requests = /* @__PURE__ */ new Map();
	latestSessionId;
	commit(native, assembled) {
		const nextNative = native.map(cloneComponent);
		const nextAssembled = assembled.map(cloneComponent);
		if (JSON.stringify(nextNative) === JSON.stringify(this.native) && JSON.stringify(nextAssembled) === JSON.stringify(this.assembled)) return;
		this.native = nextNative;
		this.assembled = nextAssembled;
		this.revision += 1;
	}
	commitRequest(sessionId, messages) {
		const next = {
			captured: captureInjectedMessages(messages),
			layout: requestLayout(messages)
		};
		const previous = this.requests.get(sessionId);
		this.latestSessionId = sessionId;
		if (previous !== void 0 && JSON.stringify(previous) === JSON.stringify(next)) return;
		this.requests.set(sessionId, structuredClone(next));
		this.revision += 1;
	}
	snapshot(requestedSessionId) {
		const sessionId = requestedSessionId ?? this.latestSessionId;
		const request = sessionId === void 0 ? void 0 : this.requests.get(sessionId);
		return {
			revision: this.revision,
			native: this.native.map(cloneComponent),
			assembled: this.assembled.map(cloneComponent),
			...sessionId === void 0 ? {} : { sessionId },
			captured: request === void 0 ? [] : structuredClone(request.captured),
			layout: request === void 0 ? {
				messageCount: 0,
				userAnchor: null
			} : { ...request.layout }
		};
	}
	capturedResource(sessionId, componentId, resourceId) {
		const resource = (this.requests.get(sessionId)?.captured.find((item) => item.id === componentId))?.resources.find((item) => item.id === resourceId);
		return resource === void 0 ? void 0 : { ...resource };
	}
};
/** The last true user input in the derived history, for the `{{user_input}}` variable. */
function latestUserInput(agent) {
	const messages = agent.session.deriveMessages();
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
	}
}
function rewriteRequest(catalog, options, next) {
	if (options.sessionId === void 0 || options.purpose !== void 0) return next();
	catalog.commitRequest(String(options.sessionId), options.messages);
	return next();
}
function respondJson(response, status, value, head = false) {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(head ? void 0 : body);
}
/** One request body that is not valid JSON: a client error, never a server fault. */
var RequestBodyError = class extends Error {};
function requestJson(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on("data", (chunk) => {
			chunks.push(chunk);
		});
		request.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(new RequestBodyError(`请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}`));
			}
		});
		request.on("error", reject);
	});
}
function requestUrl(request) {
	return new URL(request.url ?? "/", "http://prompt-studio.local");
}
function requiredString(value, name) {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} 必须是非空字符串。`);
	return value;
}
function requiredText(value, name) {
	if (typeof value !== "string") throw new TypeError(`${name} 必须是字符串。`);
	return value;
}
function resourceSelectionFromUrl(request) {
	const params = requestUrl(request).searchParams;
	return {
		sessionId: requiredString(params.get("sessionId"), "sessionId"),
		componentId: requiredString(params.get("componentId"), "componentId"),
		resourceId: requiredString(params.get("resourceId"), "resourceId")
	};
}
function resourceUpdate(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("请求体必须是 JSON 对象。");
	const record = value;
	return {
		sessionId: requiredString(record["sessionId"], "sessionId"),
		componentId: requiredString(record["componentId"], "componentId"),
		resourceId: requiredString(record["resourceId"], "resourceId"),
		content: requiredText(record["content"], "content"),
		expectedDigest: requiredString(record["expectedDigest"], "expectedDigest")
	};
}
function selectedResource(ctx, catalog, selection) {
	const session = ctx.sessions.get(selection.sessionId);
	if (session === void 0) throw new CapturedResourceNotFoundError(`会话不存在：${selection.sessionId}`);
	const resource = catalog.capturedResource(selection.sessionId, selection.componentId, selection.resourceId);
	if (resource === void 0 || !resource.editable) throw new CapturedResourceNotFoundError("捕获项没有可编辑的文件资源。");
	return {
		cwd: session.header.cwd ?? ".",
		resource
	};
}
/**
* Whether one failure is the settings service's stale-revision refusal. The
* service documents `code` as the stable machine code for wire layers, which
* keeps this classification free of a runtime import of the service package
* inside the self-contained Node bundle.
* @param error - the value thrown by a settings write.
* @returns whether the write was refused because the revision had moved.
*/
function isSettingsConflict(error) {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === "SETTINGS_CONFLICT";
}
/**
* HTTP status for one request failure: malformed input is a client error,
* an absent referent is 404, a stale write is 409, anything else is a fault.
* @param error - the value thrown while serving one request.
* @returns the response status for that failure.
*/
function requestErrorStatus(error) {
	if (error instanceof RequestBodyError || error instanceof TypeError) return 400;
	if (error instanceof CapturedResourceNotFoundError) return 404;
	if (error instanceof CapturedResourceConflictError || isSettingsConflict(error)) return 409;
	return 500;
}
function settingsSnapshot(ctx) {
	const descriptor = ctx.settings.describe().find((row) => row.ns === PROMPT_STUDIO_SETTINGS_NAMESPACE);
	if (descriptor === void 0) throw new Error(`prompt-studio is not a configurable profile entry (expected entry id "${PROMPT_STUDIO_NAMESPACE}")`);
	const value = descriptor.value;
	return {
		writable: ctx.settings.writable,
		revision: descriptor.revision,
		value: { components: value.components.map(cloneComponent) }
	};
}
function settingsUpdate(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("请求体必须是 JSON 对象。");
	const record = value;
	if (!Number.isSafeInteger(record["expectedRevision"]) || record["expectedRevision"] < 0) throw new TypeError("expectedRevision 必须是非负安全整数。");
	if (!Array.isArray(record["components"])) throw new TypeError("components 必须是数组。");
	const components = structuredClone(record["components"]);
	validatePromptComponents(components);
	return {
		components,
		expectedRevision: record["expectedRevision"]
	};
}
function installRoutes(ctx, catalog) {
	ctx.inject(["webServer"], (routeCtx) => {
		routeCtx.effect(() => routeCtx.webServer.register({
			kind: "exact",
			path: PROMPT_STUDIO_STATE_PATH,
			handler: (request, response) => {
				if (request.method !== "GET" && request.method !== "HEAD") {
					response.writeHead(405);
					response.end();
					return;
				}
				const sessionId = requestUrl(request).searchParams.get("sessionId") ?? void 0;
				respondJson(response, 200, catalog.snapshot(sessionId), request.method === "HEAD");
			}
		}), "prompt-studio: runtime catalog route");
		routeCtx.effect(() => routeCtx.webServer.register({
			kind: "exact",
			path: PROMPT_STUDIO_SETTINGS_PATH,
			handler: async (request, response) => {
				try {
					if (request.method === "GET" || request.method === "HEAD") {
						respondJson(response, 200, settingsSnapshot(routeCtx), request.method === "HEAD");
						return;
					}
					if (request.method === "POST") {
						const update = settingsUpdate(await requestJson(request));
						await routeCtx.settings.replace(PROMPT_STUDIO_SETTINGS_NAMESPACE, { components: update.components }, update.expectedRevision);
						respondJson(response, 200, settingsSnapshot(routeCtx));
						return;
					}
					response.writeHead(405);
					response.end();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					respondJson(response, requestErrorStatus(error), { error: message });
				}
			}
		}), "prompt-studio: settings route");
		routeCtx.effect(() => routeCtx.webServer.register({
			kind: "exact",
			path: PROMPT_STUDIO_RESOURCE_PATH,
			handler: async (request, response) => {
				try {
					if (request.method === "GET" || request.method === "HEAD") {
						const selected = selectedResource(routeCtx, catalog, resourceSelectionFromUrl(request));
						respondJson(response, 200, await loadCapturedResource(selected.cwd, selected.resource), request.method === "HEAD");
						return;
					}
					if (request.method === "POST") {
						const update = resourceUpdate(await requestJson(request));
						const selected = selectedResource(routeCtx, catalog, update);
						respondJson(response, 200, await saveCapturedResource(selected.cwd, selected.resource, update.content, update.expectedDigest));
						return;
					}
					response.writeHead(405);
					response.end();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					respondJson(response, requestErrorStatus(error), { error: message });
				}
			}
		}), "prompt-studio: captured resource route");
	});
}
/**
* Register the plugin Config, its live component pipeline, and the routes.
* @param ctx - the plugin's Host context.
* @param config - the validated profile-entry Config; `components` is a live reference.
*/
async function apply(ctx, config) {
	const bindings = new RuntimeBindings();
	const pipeline = new ComponentPipeline(ctx, bindings);
	const catalog = new RuntimeCatalogStore();
	/** Re-read the live component reference and rebuild the composed effect. */
	const reconfigure = () => {
		const components = config.components.get();
		validatePromptComponents(components);
		pipeline.replace(components);
	};
	ctx.systemPrompt.variable("user_input", (context) => context.agent === void 0 ? void 0 : latestUserInput(context.agent));
	ctx.on("system-prompt/assemble", async (assembly, _context, next) => {
		const native = runtimeNative(assembly.sections, bindings.ownedSectionNames);
		applyOverrides(assembly, bindings.overridesByMarker);
		const resolved = await next();
		catalog.commit(native, effectiveAssembly(resolved.sections, bindings.systemBySection));
		return resolved;
	}, { prepend: true });
	let refreshRequested = false;
	let refreshTask;
	const requestRefresh = () => {
		refreshRequested = true;
		if (refreshTask !== void 0) return;
		refreshTask = (async () => {
			while (refreshRequested) {
				refreshRequested = false;
				await ctx.systemPrompt.assemble();
			}
		})().catch((error) => {
			ctx.logger.warn("prompt-studio: runtime prompt discovery failed");
			ctx.logger.warn(error);
		}).finally(() => {
			refreshTask = void 0;
			if (refreshRequested) requestRefresh();
		});
	};
	ctx.on("system-prompt/change", requestRefresh);
	ctx.on("llm/stream", (options, next) => rewriteRequest(catalog, options, next));
	installRoutes(ctx, catalog);
	ctx.on("settings/document-updated", (namespace) => {
		if (namespace !== PROMPT_STUDIO_SETTINGS_NAMESPACE) return;
		try {
			reconfigure();
		} catch (error) {
			ctx.logger.warn("prompt-studio: rejected an invalid component set");
			ctx.logger.warn(error);
		}
	});
	reconfigure();
	await ctx.systemPrompt.assemble();
}
//#endregion
export { Config, DEFAULT_SUPPLEMENT_ORDER, PROMPT_STUDIO_NAMESPACE, PROMPT_STUDIO_RESOURCE_PATH, PROMPT_STUDIO_SETTINGS_NAMESPACE, PROMPT_STUDIO_SETTINGS_PATH, PROMPT_STUDIO_STATE_PATH, PROMPT_STUDIO_VIEW_ORDER, apply, buildDraftSystemComponents, inject, isNativeOverride, name, nextOverrideId, nextSupplementId, renderSupplementBoundary, renderSystemPreview, studioConfigSchema, validatePromptComponents };
