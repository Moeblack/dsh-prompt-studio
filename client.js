window.__ModuleLoader__.load({
	id: "dsh-prompt-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		/** Same-origin endpoint exposing the runtime-discovered prompt inventory. */
		const PROMPT_STUDIO_STATE_PATH = "/prompt-studio/state";
		/** Same-origin endpoint owned by the plugin for its private settings namespace. */
		const PROMPT_STUDIO_SETTINGS_PATH = "/prompt-studio/settings";
		/** Same-origin endpoint for resources declared by captured context producers. */
		const PROMPT_STUDIO_RESOURCE_PATH = "/prompt-studio/resource";
		/** Namespace reserved for ordered replacement markers owned by the Host half. */
		const PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX = "prompt-studio:override-marker:";
		const KINDS$1 = new Set(["native", "supplement"]);
		const POSITIONS$1 = new Set([
			"after_system",
			"anchored",
			"tail"
		]);
		const ROLES$1 = new Set([
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
				if (!KINDS$1.has(component.kind)) throw new TypeError(`prompt component "${component.id}" has an invalid kind`);
				if (!ROLES$1.has(component.role)) throw new TypeError(`prompt component "${component.id}" has an invalid role`);
				if (component.role === "system") {
					if (component.position !== void 0) throw new TypeError(`system prompt component "${component.id}" cannot define a message position`);
				} else if (component.position === void 0 || !POSITIONS$1.has(component.position)) throw new TypeError(`message prompt component "${component.id}" has an invalid position`);
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
		//#region src/client/store.ts
		function messageOf$1(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function objectRow(value, label, index) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`prompt-studio ${label} row ${String(index + 1)} is not an object`);
			return value;
		}
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
		function decodeComponents(value, label, allowNative) {
			if (!Array.isArray(value)) throw new TypeError(`prompt-studio ${label} is not an array`);
			const components = value.map((entry, index) => {
				const candidate = objectRow(entry, label, index);
				const kind = candidate["kind"];
				const position = candidate["position"];
				const role = candidate["role"];
				if (typeof candidate["id"] !== "string" || typeof kind !== "string" || !KINDS.has(kind) || typeof role !== "string" || !ROLES.has(role) || (role === "system" ? position !== void 0 && position !== "after_system" : typeof position !== "string" || !POSITIONS.has(position)) || typeof candidate["order"] !== "number" || typeof candidate["enabled"] !== "boolean" || typeof candidate["template"] !== "string" || candidate["origin"] !== void 0 && typeof candidate["origin"] !== "string" || candidate["blockType"] !== void 0 && candidate["blockType"] !== "text" && candidate["blockType"] !== "reasoning") throw new TypeError(`prompt-studio ${label} row ${String(index + 1)} has an invalid shape`);
				const component = {
					id: candidate["id"],
					kind,
					role,
					order: candidate["order"],
					enabled: candidate["enabled"],
					template: candidate["template"],
					...candidate["origin"] === void 0 ? {} : { origin: candidate["origin"] },
					...candidate["blockType"] === void 0 ? {} : { blockType: candidate["blockType"] }
				};
				if (component.role !== "system") component.position = position;
				return component;
			});
			validatePromptComponents(components, allowNative);
			return components;
		}
		function decodeConfig(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("prompt-studio settings value is not an object");
			return { components: decodeComponents(value.components, "components", false) };
		}
		function decodeCapturedResources(value, row) {
			if (!Array.isArray(value)) throw new TypeError(`prompt-studio captured row ${String(row + 1)} resources is not an array`);
			return value.map((entry, index) => {
				const candidate = objectRow(entry, "captured resource", index);
				const action = candidate["action"];
				if (typeof candidate["id"] !== "string" || typeof candidate["path"] !== "string" || action !== "set" && action !== "replace" && action !== "remove" || candidate["digest"] !== void 0 && typeof candidate["digest"] !== "string" || typeof candidate["editable"] !== "boolean") throw new TypeError(`prompt-studio captured row ${String(row + 1)} resource ${String(index + 1)} has an invalid shape`);
				return {
					id: candidate["id"],
					path: candidate["path"],
					action,
					...candidate["digest"] === void 0 ? {} : { digest: candidate["digest"] },
					editable: candidate["editable"]
				};
			});
		}
		function decodeCaptured(value) {
			if (!Array.isArray(value)) throw new TypeError("prompt-studio captured catalog is not an array");
			return value.map((entry, index) => {
				const candidate = objectRow(entry, "captured catalog", index);
				const source = candidate["source"];
				const role = candidate["role"];
				if (typeof candidate["id"] !== "string" || candidate["kind"] !== "captured" || typeof role !== "string" || !ROLES.has(role) || typeof candidate["order"] !== "number" || !Number.isSafeInteger(candidate["order"]) || candidate["enabled"] !== true || typeof candidate["template"] !== "string" || typeof candidate["messageId"] !== "string" || typeof candidate["sourceKind"] !== "string" || typeof candidate["producer"] !== "string" || candidate["form"] !== void 0 && typeof candidate["form"] !== "string" || candidate["summary"] !== void 0 && typeof candidate["summary"] !== "string" || typeof source !== "object" || source === null || Array.isArray(source)) throw new TypeError(`prompt-studio captured catalog row ${String(index + 1)} has an invalid shape`);
				return {
					id: candidate["id"],
					kind: "captured",
					role,
					order: candidate["order"],
					enabled: true,
					template: candidate["template"],
					messageId: candidate["messageId"],
					sourceKind: candidate["sourceKind"],
					producer: candidate["producer"],
					...candidate["form"] === void 0 ? {} : { form: candidate["form"] },
					...candidate["summary"] === void 0 ? {} : { summary: candidate["summary"] },
					source: structuredClone(source),
					resources: decodeCapturedResources(candidate["resources"], index)
				};
			});
		}
		function decodeCatalog(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("prompt-studio runtime catalog is not an object");
			const candidate = value;
			if (typeof candidate.revision !== "number" || !Number.isSafeInteger(candidate.revision)) throw new TypeError("prompt-studio runtime catalog has an invalid revision");
			if (candidate.sessionId !== void 0 && typeof candidate.sessionId !== "string") throw new TypeError("prompt-studio runtime catalog has an invalid session id");
			const layout = objectRow(candidate.layout, "request layout", 0);
			if (!Number.isSafeInteger(layout["messageCount"]) || layout["messageCount"] < 0) throw new TypeError("prompt-studio runtime catalog has an invalid message count");
			if (layout["userAnchor"] !== null && (!Number.isSafeInteger(layout["userAnchor"]) || layout["userAnchor"] < 0)) throw new TypeError("prompt-studio runtime catalog has an invalid user anchor");
			return {
				revision: candidate.revision,
				native: decodeComponents(candidate.native, "native catalog", true),
				assembled: decodeComponents(candidate.assembled, "assembled catalog", true),
				...candidate.sessionId === void 0 ? {} : { sessionId: candidate.sessionId },
				captured: decodeCaptured(candidate.captured),
				layout: {
					messageCount: layout["messageCount"],
					userAnchor: layout["userAnchor"]
				}
			};
		}
		function decodeSettings(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("prompt-studio settings snapshot is not an object");
			const candidate = value;
			if (typeof candidate["writable"] !== "boolean") throw new TypeError("prompt-studio settings writable flag is invalid");
			if (typeof candidate["revision"] !== "number" || !Number.isSafeInteger(candidate["revision"])) throw new TypeError("prompt-studio settings revision is invalid");
			return {
				writable: candidate["writable"],
				revision: candidate["revision"],
				value: decodeConfig(candidate["value"])
			};
		}
		function decodeResource(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("prompt-studio captured resource is not an object");
			const candidate = value;
			if (typeof candidate["path"] !== "string" || typeof candidate["content"] !== "string" || typeof candidate["digest"] !== "string") throw new TypeError("prompt-studio captured resource has an invalid shape");
			return {
				path: candidate["path"],
				content: candidate["content"],
				digest: candidate["digest"]
			};
		}
		async function responseValue(response) {
			const value = await response.json();
			if (response.ok) return value;
			const message = typeof value === "object" && value !== null && !Array.isArray(value) ? value["error"] : void 0;
			throw new Error(typeof message === "string" ? message : `请求失败：HTTP ${String(response.status)}`);
		}
		async function loadSettings() {
			return decodeSettings(await responseValue(await fetch(PROMPT_STUDIO_SETTINGS_PATH, {
				method: "GET",
				headers: { accept: "application/json" },
				cache: "no-store"
			})));
		}
		async function loadCatalog(sessionId) {
			const path = sessionId === void 0 ? PROMPT_STUDIO_STATE_PATH : `${PROMPT_STUDIO_STATE_PATH}?sessionId=${encodeURIComponent(sessionId)}`;
			return decodeCatalog(await responseValue(await fetch(path, {
				method: "GET",
				headers: { accept: "application/json" },
				cache: "no-store"
			})));
		}
		/** One browser-side controller, shared by every session-scoped mount of the view. */
		var PromptStudioStore = class {
			sessionId;
			/** Observable remote namespace state consumed by every mounted Prompt Studio view. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				status: "idle",
				error: null,
				writable: false,
				revision: 0,
				components: [],
				native: [],
				assembled: [],
				captured: [],
				capturedSessionId: null,
				messageCount: 0,
				userAnchor: null,
				catalogRevision: 0
			});
			generation = 0;
			constructor(sessionId) {
				this.sessionId = sessionId;
			}
			/** Refetch the namespace descriptor and runtime registry; newest request wins. */
			async load() {
				const generation = ++this.generation;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				try {
					const [settings, catalog] = await Promise.all([loadSettings(), loadCatalog(this.sessionId)]);
					if (generation !== this.generation) return;
					this.accept(settings, catalog);
				} catch (error) {
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "error";
						state.error = messageOf$1(error);
					});
				}
			}
			/** Persist one unified component draft with stale-editor protection. */
			async save(components, expectedRevision) {
				validatePromptComponents(components);
				const generation = ++this.generation;
				const settings = decodeSettings(await responseValue(await fetch(PROMPT_STUDIO_SETTINGS_PATH, {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json"
					},
					body: JSON.stringify({
						components: components.map((component) => ({ ...component })),
						expectedRevision
					})
				})));
				const catalog = await loadCatalog(this.sessionId);
				if (generation !== this.generation) return;
				this.accept(settings, catalog);
			}
			/** Load one raw file selected by a captured instructions-form context. */
			async loadResource(componentId, resourceId) {
				const sessionId = this.requireCapturedSession();
				const query = new URLSearchParams({
					sessionId,
					componentId,
					resourceId
				});
				return decodeResource(await responseValue(await fetch(`${PROMPT_STUDIO_RESOURCE_PATH}?${query.toString()}`, {
					method: "GET",
					headers: { accept: "application/json" },
					cache: "no-store"
				})));
			}
			/** Write one captured source file; its producer remains responsible for next-step reconciliation. */
			async saveResource(componentId, resourceId, content, expectedDigest) {
				const sessionId = this.requireCapturedSession();
				return decodeResource(await responseValue(await fetch(PROMPT_STUDIO_RESOURCE_PATH, {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json"
					},
					body: JSON.stringify({
						sessionId,
						componentId,
						resourceId,
						content,
						expectedDigest
					})
				})));
			}
			requireCapturedSession() {
				const sessionId = this.store.getSnapshot().capturedSessionId;
				if (sessionId === null) throw new Error("当前没有已捕获请求所属的会话。");
				return sessionId;
			}
			accept(settings, catalog) {
				this.store.update((state) => {
					state.status = "ready";
					state.error = null;
					state.writable = settings.writable;
					state.revision = settings.revision;
					state.components = settings.value.components;
					state.native = catalog.native;
					state.assembled = catalog.assembled;
					state.captured = catalog.captured;
					state.capturedSessionId = catalog.sessionId ?? null;
					state.messageCount = catalog.layout.messageCount;
					state.userAnchor = catalog.layout.userAnchor;
					state.catalogRevision = catalog.revision;
				});
			}
		};
		/** Refresh only after the user has opened the view once. */
		function refreshIfLoaded(controller) {
			if (controller.store.getSnapshot().status === "idle") return;
			controller.load();
		}
		//#endregion
		//#region \0dsh-css:H:\DeepseekHarness0.6\work\dsh-prompt-studio\src\client\PromptStudioView.module.css.mjs
		const css = ".L9p1Pq_root{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);padding:24px;overflow:auto}.L9p1Pq_pageHeader{justify-content:space-between;align-items:flex-start;gap:20px;max-width:1480px;margin:0 auto 16px;display:flex}.L9p1Pq_title,.L9p1Pq_subtitle,.L9p1Pq_intro,.L9p1Pq_caption,.L9p1Pq_notice,.L9p1Pq_error,.L9p1Pq_empty,.L9p1Pq_excerpt,.L9p1Pq_emptyText,.L9p1Pq_origin,.L9p1Pq_builtinText{margin:0}.L9p1Pq_title{font-size:22px;font-weight:600;line-height:30px}.L9p1Pq_intro{max-width:760px;color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:14px;line-height:22px}.L9p1Pq_headerActions{flex-wrap:wrap;flex:none;justify-content:flex-end;gap:8px;display:flex}.L9p1Pq_primaryButton,.L9p1Pq_secondaryButton,.L9p1Pq_textButton,.L9p1Pq_dangerButton{box-sizing:border-box;font:inherit;cursor:pointer;border:0}.L9p1Pq_primaryButton,.L9p1Pq_secondaryButton{border-radius:18px;justify-content:center;align-items:center;height:36px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}.L9p1Pq_primaryButton{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill)}.L9p1Pq_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.L9p1Pq_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0}.L9p1Pq_secondaryButton:hover:not(:disabled),.L9p1Pq_textButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.L9p1Pq_primaryButton:disabled,.L9p1Pq_secondaryButton:disabled,.L9p1Pq_textButton:disabled,.L9p1Pq_dangerButton:disabled{cursor:default;opacity:.4}.L9p1Pq_primaryButton:focus-visible,.L9p1Pq_secondaryButton:focus-visible,.L9p1Pq_textButton:focus-visible,.L9p1Pq_dangerButton:focus-visible,.L9p1Pq_input:focus-visible,.L9p1Pq_orderInput:focus-visible,.L9p1Pq_select:focus-visible,.L9p1Pq_textarea:focus-visible,.L9p1Pq_builtinsSummary:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.L9p1Pq_notice,.L9p1Pq_error{max-width:1480px;margin:0 auto 10px;font-size:12px;line-height:18px}.L9p1Pq_notice{color:var(--dsw-alias-state-warn-label)}.L9p1Pq_error{color:var(--dsw-alias-state-error-primary)}.L9p1Pq_status{box-sizing:border-box;width:100%;height:100%;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);flex-direction:column;align-items:flex-start;gap:12px;padding:24px;display:flex}.L9p1Pq_status .L9p1Pq_error{margin:0}.L9p1Pq_columns{grid-template-columns:minmax(440px,1fr) minmax(400px,1fr);align-items:start;gap:18px;max-width:1480px;margin:0 auto;display:grid}.L9p1Pq_editorColumn,.L9p1Pq_previewColumn{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;min-width:0;padding:16px}.L9p1Pq_previewColumn{position:sticky;top:0}.L9p1Pq_sectionHeading{justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;display:flex}.L9p1Pq_subtitle{font-size:16px;font-weight:500;line-height:24px}.L9p1Pq_caption,.L9p1Pq_origin,.L9p1Pq_emptyText{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.L9p1Pq_count,.L9p1Pq_orderBadge,.L9p1Pq_stateBadge,.L9p1Pq_kindBadge,.L9p1Pq_positionBadge,.L9p1Pq_roleBadge{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:18px}.L9p1Pq_empty{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:18px;font-size:14px;line-height:22px}.L9p1Pq_componentList,.L9p1Pq_userList,.L9p1Pq_builtinList{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.L9p1Pq_componentCard,.L9p1Pq_userCard,.L9p1Pq_builtinCard{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px}.L9p1Pq_rowHeader{align-items:center;gap:8px;min-width:0;display:flex}.L9p1Pq_enabledControl{color:var(--dsw-alias-label-secondary);flex:none;align-items:center;gap:5px;font-size:12px;line-height:18px;display:inline-flex}.L9p1Pq_enabledControl input{accent-color:var(--dsw-alias-brand-primary)}.L9p1Pq_sectionName{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:22px;overflow:hidden}.L9p1Pq_orderBadge{margin-left:auto}.L9p1Pq_kindBadge,.L9p1Pq_positionBadge,.L9p1Pq_roleBadge,.L9p1Pq_stateBadge{background:var(--dsw-alias-bg-module-platform);border-radius:9px;padding:1px 6px}.L9p1Pq_kindBadge{color:var(--dsw-alias-label-secondary)}.L9p1Pq_textButton,.L9p1Pq_dangerButton{height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border-radius:14px;flex:none;padding:0 9px;font-size:12px;line-height:18px}.L9p1Pq_dangerButton{color:var(--dsw-alias-state-error-primary)}.L9p1Pq_dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}.L9p1Pq_componentEditor,.L9p1Pq_sectionEditor{background:var(--dsw-alias-bg-module-platform);border-radius:10px;grid-template-columns:minmax(0,1fr) 120px minmax(150px,.6fr);gap:10px;margin-top:12px;padding:12px;display:grid}.L9p1Pq_field{flex-direction:column;gap:5px;display:flex}.L9p1Pq_templateField,.L9p1Pq_textField,.L9p1Pq_builtinTextField{grid-column:1/-1}.L9p1Pq_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}.L9p1Pq_input,.L9p1Pq_orderInput,.L9p1Pq_select,.L9p1Pq_textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit;border-radius:8px;font-size:13px}.L9p1Pq_input,.L9p1Pq_orderInput,.L9p1Pq_select{height:32px;padding:0 9px}.L9p1Pq_textarea{resize:vertical;min-height:150px;padding:9px;line-height:20px}.L9p1Pq_input:disabled,.L9p1Pq_orderInput:disabled,.L9p1Pq_select:disabled,.L9p1Pq_textarea:disabled{cursor:default;opacity:.6}.L9p1Pq_excerpt,.L9p1Pq_builtinText{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;margin-top:9px;font-size:12px;line-height:18px}.L9p1Pq_excerpt{-webkit-line-clamp:3;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.L9p1Pq_capturedText,.L9p1Pq_sourceDetails pre{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:19px}.L9p1Pq_sourceDetails{color:var(--dsw-alias-label-tertiary);margin-top:9px;font-size:12px;line-height:18px}.L9p1Pq_sourceDetails summary{cursor:pointer;width:fit-content}.L9p1Pq_resourceActions{flex-wrap:wrap;gap:6px;margin-top:10px;display:flex}.L9p1Pq_readonlyResource,.L9p1Pq_readonlyNotice{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.L9p1Pq_readonlyResource{padding:5px 9px}.L9p1Pq_readonlyNotice{margin:8px 0 0}.L9p1Pq_resourceEditor{background:var(--dsw-alias-bg-module-platform);border-radius:10px;margin-top:10px;padding:12px}.L9p1Pq_resourceEditorHeader,.L9p1Pq_resourceEditorFooter{justify-content:space-between;align-items:center;gap:12px;display:flex}.L9p1Pq_resourceEditorHeader{color:var(--dsw-alias-label-primary);margin-bottom:8px;font-size:13px}.L9p1Pq_resourceEditorFooter{align-items:flex-start;margin-top:8px}.L9p1Pq_emptyText{margin-top:9px}.L9p1Pq_builtins{border-top:1px solid var(--dsw-alias-border-l2);margin-top:14px;padding-top:14px}.L9p1Pq_builtinsSummary{width:fit-content;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;align-items:center;gap:8px;font-size:14px;font-weight:500;line-height:22px;display:flex}.L9p1Pq_builtinsSummary .L9p1Pq_count{margin-left:4px}.L9p1Pq_builtinList{margin-top:10px}.L9p1Pq_builtinCard{background:var(--dsw-alias-bg-module-platform)}.L9p1Pq_origin{margin-top:5px}.L9p1Pq_assemblyOrder{background:var(--dsw-alias-bg-module-platform);border-radius:10px;flex-direction:column;gap:2px;max-height:190px;margin-bottom:12px;padding:8px;display:flex;overflow:auto}.L9p1Pq_assemblyOrder,.L9p1Pq_preview{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.L9p1Pq_assemblyRow{min-height:24px;color:var(--dsw-alias-label-secondary);grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:7px;font-size:12px;line-height:18px;display:grid}.L9p1Pq_assemblyIndex,.L9p1Pq_assemblyOrderValue{color:var(--dsw-alias-label-tertiary)}.L9p1Pq_preview{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;min-height:320px;max-height:calc(100vh - 380px);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:10px;margin:0;padding:14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:19px;overflow:auto}@media (width<=1000px){.L9p1Pq_columns{grid-template-columns:1fr}.L9p1Pq_previewColumn{position:static}.L9p1Pq_preview{max-height:520px}}@media (width<=680px){.L9p1Pq_root{padding:16px}.L9p1Pq_pageHeader{flex-direction:column}.L9p1Pq_headerActions{width:100%}.L9p1Pq_primaryButton,.L9p1Pq_secondaryButton{flex:1}.L9p1Pq_rowHeader{flex-wrap:wrap}.L9p1Pq_sectionName{flex-basis:100%;order:-1}.L9p1Pq_orderBadge{margin-left:0}.L9p1Pq_componentEditor,.L9p1Pq_sectionEditor{grid-template-columns:1fr}.L9p1Pq_templateField,.L9p1Pq_textField,.L9p1Pq_builtinTextField{grid-column:auto}}.L9p1Pq_previewSystem{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:0}.L9p1Pq_previewSupplement{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;margin:8px 0 0;padding:8px 10px}.L9p1Pq_previewCaptured{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-state-warn-label);background:var(--dsw-alias-bg-module-platform);border-radius:6px;margin:8px 0 0;padding:8px 10px}.L9p1Pq_previewSupplementTag{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:4px;margin-bottom:4px;padding:0 6px;font-size:11px;line-height:18px;display:inline-block}.L9p1Pq_previewSupplementText{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}";
		const tagId = "dsh-prompt-studio/PromptStudioView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-prompt-studio";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PromptStudioView_module_css_default = {
			"assemblyIndex": "L9p1Pq_assemblyIndex",
			"assemblyOrder": "L9p1Pq_assemblyOrder",
			"assemblyOrderValue": "L9p1Pq_assemblyOrderValue",
			"assemblyRow": "L9p1Pq_assemblyRow",
			"builtinCard": "L9p1Pq_builtinCard",
			"builtinList": "L9p1Pq_builtinList",
			"builtinText": "L9p1Pq_builtinText",
			"builtinTextField": "L9p1Pq_builtinTextField",
			"builtins": "L9p1Pq_builtins",
			"builtinsSummary": "L9p1Pq_builtinsSummary",
			"caption": "L9p1Pq_caption",
			"capturedText": "L9p1Pq_capturedText",
			"columns": "L9p1Pq_columns",
			"componentCard": "L9p1Pq_componentCard",
			"componentEditor": "L9p1Pq_componentEditor",
			"componentList": "L9p1Pq_componentList",
			"count": "L9p1Pq_count",
			"dangerButton": "L9p1Pq_dangerButton",
			"editorColumn": "L9p1Pq_editorColumn",
			"empty": "L9p1Pq_empty",
			"emptyText": "L9p1Pq_emptyText",
			"enabledControl": "L9p1Pq_enabledControl",
			"error": "L9p1Pq_error",
			"excerpt": "L9p1Pq_excerpt",
			"field": "L9p1Pq_field",
			"fieldLabel": "L9p1Pq_fieldLabel",
			"headerActions": "L9p1Pq_headerActions",
			"input": "L9p1Pq_input",
			"intro": "L9p1Pq_intro",
			"kindBadge": "L9p1Pq_kindBadge",
			"notice": "L9p1Pq_notice",
			"orderBadge": "L9p1Pq_orderBadge",
			"orderInput": "L9p1Pq_orderInput",
			"origin": "L9p1Pq_origin",
			"pageHeader": "L9p1Pq_pageHeader",
			"positionBadge": "L9p1Pq_positionBadge",
			"preview": "L9p1Pq_preview",
			"previewCaptured": "L9p1Pq_previewCaptured",
			"previewColumn": "L9p1Pq_previewColumn",
			"previewSupplement": "L9p1Pq_previewSupplement",
			"previewSupplementTag": "L9p1Pq_previewSupplementTag",
			"previewSupplementText": "L9p1Pq_previewSupplementText",
			"previewSystem": "L9p1Pq_previewSystem",
			"primaryButton": "L9p1Pq_primaryButton",
			"readonlyNotice": "L9p1Pq_readonlyNotice",
			"readonlyResource": "L9p1Pq_readonlyResource",
			"resourceActions": "L9p1Pq_resourceActions",
			"resourceEditor": "L9p1Pq_resourceEditor",
			"resourceEditorFooter": "L9p1Pq_resourceEditorFooter",
			"resourceEditorHeader": "L9p1Pq_resourceEditorHeader",
			"roleBadge": "L9p1Pq_roleBadge",
			"root": "L9p1Pq_root",
			"rowHeader": "L9p1Pq_rowHeader",
			"secondaryButton": "L9p1Pq_secondaryButton",
			"sectionEditor": "L9p1Pq_sectionEditor",
			"sectionHeading": "L9p1Pq_sectionHeading",
			"sectionName": "L9p1Pq_sectionName",
			"select": "L9p1Pq_select",
			"sourceDetails": "L9p1Pq_sourceDetails",
			"stateBadge": "L9p1Pq_stateBadge",
			"status": "L9p1Pq_status",
			"subtitle": "L9p1Pq_subtitle",
			"templateField": "L9p1Pq_templateField",
			"textButton": "L9p1Pq_textButton",
			"textField": "L9p1Pq_textField",
			"textarea": "L9p1Pq_textarea",
			"title": "L9p1Pq_title",
			"userCard": "L9p1Pq_userCard",
			"userList": "L9p1Pq_userList"
		};
		//#endregion
		//#region src/client/PromptStudioView.tsx
		/** Unified prompt-component editor and request-layout preview. */
		const POSITION_ORDER = {
			after_system: 0,
			anchored: 1,
			tail: 2
		};
		const KIND_LABEL = {
			native: "原生",
			supplement: "补充"
		};
		const POSITION_LABEL = {
			after_system: "系统后",
			anchored: "最后用户输入后",
			tail: "请求尾部"
		};
		const ROLE_LABEL = {
			system: "system",
			user: "user",
			assistant: "assistant"
		};
		function copyComponents(components) {
			return components.map((component) => ({ ...component }));
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function rowPlacement(row) {
			if (row.type === "captured") return 1;
			if (row.component.role === "system") return 0;
			return 2 + POSITION_ORDER[row.component.position ?? "tail"];
		}
		function compareRows(left, right) {
			return rowPlacement(left) - rowPlacement(right) || left.component.order - right.component.order;
		}
		function previewText(systemText, supplements, captured, userAnchor) {
			const blocks = [];
			if (systemText.length > 0) blocks.push({
				kind: "system",
				text: systemText
			});
			const appendSupplements = (position) => {
				for (const component of supplements.filter((item) => item.position === position)) blocks.push({
					kind: "supplement",
					id: component.id,
					text: component.template
				});
			};
			const appendCaptured = (items) => {
				for (const component of items) blocks.push({
					kind: "captured",
					id: component.id,
					text: component.template,
					label: `${component.producer}${component.form === void 0 ? "" : ` · ${component.form}`} · 消息 ${String(component.order + 1)}`
				});
			};
			appendSupplements("after_system");
			const orderedCaptured = [...captured].sort((left, right) => left.order - right.order);
			if (userAnchor === null) appendCaptured(orderedCaptured);
			else {
				appendCaptured(orderedCaptured.filter((component) => component.order <= userAnchor));
				appendSupplements("anchored");
				appendCaptured(orderedCaptured.filter((component) => component.order > userAnchor));
			}
			appendSupplements("tail");
			return blocks;
		}
		function CapturedComponentCard({ component, controller }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [loadingResource, setLoadingResource] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const editResource = (resource) => {
				if (!resource.editable || loadingResource !== null) return;
				setLoadingResource(resource.id);
				setDraft(null);
				controller.loadResource(component.id, resource.id).then((snapshot) => {
					setDraft({
						resource,
						content: snapshot.content,
						digest: snapshot.digest,
						saving: false,
						saved: false,
						error: null
					});
				}).catch((error) => {
					setDraft({
						resource,
						content: "",
						digest: "",
						saving: false,
						saved: false,
						error: messageOf(error)
					});
				}).finally(() => {
					setLoadingResource(null);
				});
			};
			const saveResource = () => {
				if (draft === null || draft.saving || draft.digest.length === 0) return;
				setDraft((current) => current === null ? null : {
					...current,
					saving: true,
					saved: false,
					error: null
				});
				controller.saveResource(component.id, draft.resource.id, draft.content, draft.digest).then((snapshot) => {
					setDraft((current) => current === null ? null : {
						...current,
						content: snapshot.content,
						digest: snapshot.digest,
						saving: false,
						saved: true,
						error: null
					});
				}).catch((error) => {
					setDraft((current) => current === null ? null : {
						...current,
						saving: false,
						saved: false,
						error: messageOf(error)
					});
				});
			};
			const sourceLabel = `${component.producer} · kind=${component.sourceKind}${component.form === void 0 ? "" : ` · form=${component.form}`}`;
			const editable = component.resources.filter((resource) => resource.editable);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: PromptStudioView_module_css_default["componentCard"],
				"aria-label": `捕获上下文 ${component.id}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PromptStudioView_module_css_default["rowHeader"],
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PromptStudioView_module_css_default["stateBadge"],
								children: "自动捕获"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PromptStudioView_module_css_default["kindBadge"],
								children: "上下文"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PromptStudioView_module_css_default["sectionName"],
								children: sourceLabel
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PromptStudioView_module_css_default["roleBadge"],
								children: component.role
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: PromptStudioView_module_css_default["orderBadge"],
								children: ["消息位置 ", String(component.order + 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PromptStudioView_module_css_default["textButton"],
								onClick: () => {
									setExpanded((value) => !value);
								},
								children: expanded ? "收起" : "查看"
							})
						]
					}),
					component.summary === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PromptStudioView_module_css_default["origin"],
						children: component.summary
					}),
					expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: PromptStudioView_module_css_default["capturedText"],
						children: component.template
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: PromptStudioView_module_css_default["sourceDetails"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "来源元数据" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: JSON.stringify(component.source, null, 2) })]
					})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PromptStudioView_module_css_default["excerpt"],
						children: component.template || "（空内容）"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: PromptStudioView_module_css_default["resourceActions"],
						children: component.resources.map((resource) => resource.editable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PromptStudioView_module_css_default["textButton"],
							disabled: loadingResource !== null,
							onClick: () => {
								editResource(resource);
							},
							children: loadingResource === resource.id ? "正在读取…" : `编辑文件：${resource.path}`
						}, resource.id) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: PromptStudioView_module_css_default["readonlyResource"],
							children: [
								resource.path,
								"（",
								resource.action === "remove" ? "已移除" : "只读",
								"）"
							]
						}, resource.id))
					}),
					editable.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PromptStudioView_module_css_default["readonlyNotice"],
						children: "只读捕获：来源没有提供可解析的文件变更。"
					}) : null,
					draft === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PromptStudioView_module_css_default["resourceEditor"],
						"aria-label": `编辑上下文文件 ${draft.resource.path}`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PromptStudioView_module_css_default["resourceEditorHeader"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: draft.resource.path }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: PromptStudioView_module_css_default["textButton"],
									onClick: () => {
										setDraft(null);
									},
									children: "关闭"
								})]
							}),
							draft.error === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PromptStudioView_module_css_default["error"],
								children: draft.error
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: PromptStudioView_module_css_default["textarea"],
								value: draft.content,
								disabled: draft.digest.length === 0 || draft.saving,
								rows: 12,
								onChange: (event) => {
									setDraft((current) => current === null ? null : {
										...current,
										content: event.target.value,
										saved: false
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PromptStudioView_module_css_default["resourceEditorFooter"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: PromptStudioView_module_css_default["caption"],
									children: draft.saved ? "已写回；下一轮请求仍由原上下文生产者按其状态机协调。" : "保存只修改来源文件，不改写已进入会话的上下文事件。"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: PromptStudioView_module_css_default["primaryButton"],
									disabled: draft.digest.length === 0 || draft.saving,
									onClick: saveResource,
									children: draft.saving ? "正在写回…" : "写回文件"
								})]
							})
						]
					})
				]
			});
		}
		/** Conversation-view entry point. */
		function PromptStudioView({ controller, useSnapshot, useSession }) {
			(0, react.useEffect)(() => {
				controller.load();
			}, [controller, useSession((snapshot) => `${String(snapshot.sessionId)}:${snapshot.running ? "running" : "idle"}:${snapshot.openState}`)]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptStudioSurface, {
				controller,
				useSnapshot
			});
		}
		/** Settings-page entry point sharing the exact live editor state. */
		function PromptStudioSettingsSection({ controller, useSnapshot }) {
			(0, react.useEffect)(() => {
				controller.load();
			}, [controller]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptStudioSurface, {
				controller,
				useSnapshot
			});
		}
		function PromptStudioSurface({ controller, useSnapshot }) {
			const remote = useSnapshot((state) => state);
			if (remote.status === "idle" || remote.status === "loading" && remote.native.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: PromptStudioView_module_css_default["status"],
				children: "正在载入 Prompt Studio…"
			});
			if (remote.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PromptStudioView_module_css_default["status"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: PromptStudioView_module_css_default["error"],
					children: remote.error
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: PromptStudioView_module_css_default["secondaryButton"],
					onClick: () => {
						controller.load();
					},
					children: "重试"
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptStudioEditor, {
				controller,
				remote
			});
		}
		function PromptStudioEditor({ controller, remote }) {
			const [draft, setDraft] = (0, react.useState)(() => copyComponents(remote.components));
			const [dirty, setDirty] = (0, react.useState)(false);
			const [editingIndex, setEditingIndex] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setDraft(copyComponents(remote.components));
				setDirty(false);
				setSaving(false);
				setSaveError(null);
				setEditingIndex((index) => index !== null && index < remote.components.length ? index : null);
			}, [
				remote.catalogRevision,
				remote.components,
				remote.revision
			]);
			const rows = (0, react.useMemo)(() => [
				...remote.native.map((component) => ({
					type: "native",
					component
				})),
				...remote.captured.map((component) => ({
					type: "captured",
					component
				})),
				...draft.map((component, configuredIndex) => ({
					type: "configured",
					component,
					configuredIndex
				}))
			].sort(compareRows), [
				draft,
				remote.captured,
				remote.native
			]);
			const draftSystem = (0, react.useMemo)(() => dirty ? buildDraftSystemComponents(remote.native, draft) : copyComponents(remote.assembled), [
				dirty,
				draft,
				remote.assembled,
				remote.native
			]);
			const requestSupplements = (0, react.useMemo)(() => {
				const nativeIds = new Set(remote.native.map((component) => component.id));
				return draft.filter((component) => component.enabled && component.role !== "system" && (!isNativeOverride(component) || nativeIds.has(component.origin)));
			}, [draft, remote.native]);
			const orderedRequestSupplements = (0, react.useMemo)(() => requestSupplements.map((component, declaration) => ({
				component,
				declaration
			})).sort((left, right) => POSITION_ORDER[left.component.position ?? "tail"] - POSITION_ORDER[right.component.position ?? "tail"] || left.component.order - right.component.order || left.declaration - right.declaration).map((entry) => entry.component), [requestSupplements]);
			const systemContent = (0, react.useMemo)(() => renderSystemPreview(draftSystem), [draftSystem]);
			const preview = (0, react.useMemo)(() => previewText(systemContent, orderedRequestSupplements, remote.captured, remote.userAnchor), [
				orderedRequestSupplements,
				remote.captured,
				remote.userAnchor,
				systemContent
			]);
			const changeComponent = (index, patch) => {
				setDraft((current) => current.map((component, position) => position === index ? {
					...component,
					...patch
				} : component));
				setDirty(true);
				setSaveError(null);
			};
			const changeOrigin = (index, origin) => {
				setDraft((current) => current.map((component, position) => {
					if (position !== index) return component;
					const next = { ...component };
					if (origin.length === 0) delete next.origin;
					else next.origin = origin;
					return next;
				}));
				setDirty(true);
				setSaveError(null);
			};
			const changeRole = (index, role) => {
				setDraft((current) => current.map((component, position) => {
					if (position !== index) return component;
					const next = {
						...component,
						role
					};
					if (role === "system") delete next.position;
					else next.position ??= "after_system";
					if (role !== "assistant") delete next.blockType;
					return next;
				}));
				setDirty(true);
				setSaveError(null);
			};
			const addSupplement = () => {
				setDraft((current) => {
					const next = [...current, {
						id: nextSupplementId(current),
						kind: "supplement",
						position: "tail",
						role: "user",
						order: 100,
						enabled: true,
						template: ""
					}];
					setEditingIndex(next.length - 1);
					return next;
				});
				setDirty(true);
				setSaveError(null);
			};
			const addOverride = (native) => {
				const existing = draft.findIndex((component) => isNativeOverride(component) && component.origin === native.id);
				if (existing >= 0) {
					setEditingIndex(existing);
					return;
				}
				setDraft((current) => {
					const next = [...current, {
						id: nextOverrideId(current, native.id),
						kind: "supplement",
						role: "system",
						order: native.order,
						enabled: true,
						template: native.template,
						origin: native.id
					}];
					setEditingIndex(next.length - 1);
					return next;
				});
				setDirty(true);
				setSaveError(null);
			};
			const removeComponent = (index) => {
				setDraft((current) => current.filter((_component, position) => position !== index));
				setEditingIndex((current) => {
					if (current === null || current === index) return null;
					return current > index ? current - 1 : current;
				});
				setDirty(true);
				setSaveError(null);
			};
			const save = () => {
				if (!dirty || saving || !remote.writable) return;
				setSaving(true);
				setSaveError(null);
				controller.save(draft, remote.revision).catch((error) => {
					setSaveError(messageOf(error));
				}).finally(() => {
					setSaving(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PromptStudioView_module_css_default["root"],
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PromptStudioView_module_css_default["pageHeader"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: PromptStudioView_module_css_default["title"],
							children: "Prompt Studio"
						}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PromptStudioView_module_css_default["headerActions"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PromptStudioView_module_css_default["secondaryButton"],
								disabled: !remote.writable,
								onClick: addSupplement,
								children: "新增补充"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PromptStudioView_module_css_default["primaryButton"],
								disabled: !dirty || saving || !remote.writable,
								onClick: save,
								children: saving ? "正在保存…" : "保存更改"
							})]
						})]
					}),
					!remote.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PromptStudioView_module_css_default["notice"],
						children: "当前设置提供方为只读。"
					}) : null,
					remote.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PromptStudioView_module_css_default["notice"],
						children: "正在刷新运行时组件…"
					}) : null,
					saveError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PromptStudioView_module_css_default["error"],
						children: saveError
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PromptStudioView_module_css_default["columns"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: PromptStudioView_module_css_default["editorColumn"],
							"aria-label": "统一提示词组件",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PromptStudioView_module_css_default["sectionHeading"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: PromptStudioView_module_css_default["subtitle"],
									children: "组件"
								}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: PromptStudioView_module_css_default["count"],
									children: String(rows.length)
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
								className: PromptStudioView_module_css_default["componentList"],
								children: rows.map((row) => {
									if (row.type === "captured") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapturedComponentCard, {
										component: row.component,
										controller
									}, row.component.id);
									const { component } = row;
									const configuredIndex = row.type === "configured" ? row.configuredIndex : -1;
									const isNative = row.type === "native";
									const editing = !isNative && editingIndex === configuredIndex;
									const override = isNativeOverride(component);
									const overrideExists = isNative && draft.some((item) => isNativeOverride(item) && item.origin === component.id);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: PromptStudioView_module_css_default["componentCard"],
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: PromptStudioView_module_css_default["rowHeader"],
												children: [
													isNative ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: PromptStudioView_module_css_default["stateBadge"],
														children: "运行时"
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: PromptStudioView_module_css_default["enabledControl"],
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "checkbox",
															checked: component.enabled,
															disabled: !remote.writable,
															onChange: (event) => {
																changeComponent(configuredIndex, { enabled: event.target.checked });
															}
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: component.enabled ? "启用" : override ? "关闭原生" : "停用" })]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: PromptStudioView_module_css_default["kindBadge"],
														children: KIND_LABEL[component.kind]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: PromptStudioView_module_css_default["sectionName"],
														children: component.id
													}),
													component.position === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: PromptStudioView_module_css_default["positionBadge"],
														children: POSITION_LABEL[component.position]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: PromptStudioView_module_css_default["roleBadge"],
														children: component.role
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: PromptStudioView_module_css_default["orderBadge"],
														children: [
															component.role === "system" ? "层级" : "间隙内顺序",
															" ",
															String(component.order)
														]
													}),
													isNative ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: PromptStudioView_module_css_default["textButton"],
														disabled: !remote.writable,
														onClick: () => {
															addOverride(component);
														},
														children: overrideExists ? "编辑覆盖" : "创建覆盖"
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: PromptStudioView_module_css_default["textButton"],
														onClick: () => {
															setEditingIndex(editing ? null : configuredIndex);
														},
														children: editing ? "收起" : "编辑"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: PromptStudioView_module_css_default["dangerButton"],
														disabled: !remote.writable,
														onClick: () => {
															removeComponent(configuredIndex);
														},
														children: override ? "恢复原生" : "删除"
													})] })
												]
											}),
											component.origin !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												className: PromptStudioView_module_css_default["origin"],
												children: ["覆盖目标：", component.origin]
											}) : null,
											editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: PromptStudioView_module_css_default["componentEditor"],
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: PromptStudioView_module_css_default["field"],
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PromptStudioView_module_css_default["fieldLabel"],
															children: "标识"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															className: PromptStudioView_module_css_default["input"],
															value: component.id,
															disabled: !remote.writable,
															onChange: (event) => {
																changeComponent(configuredIndex, { id: event.target.value });
															}
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: PromptStudioView_module_css_default["field"],
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PromptStudioView_module_css_default["fieldLabel"],
															children: component.role === "system" ? "系统层级" : "间隙内顺序"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															className: PromptStudioView_module_css_default["orderInput"],
															type: "number",
															value: component.order,
															disabled: !remote.writable,
															onChange: (event) => {
																changeComponent(configuredIndex, { order: Number(event.target.value) });
															}
														})]
													}),
													component.role === "system" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: PromptStudioView_module_css_default["field"],
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PromptStudioView_module_css_default["fieldLabel"],
															children: "消息间隙"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
															className: PromptStudioView_module_css_default["select"],
															value: component.position,
															disabled: !remote.writable,
															onChange: (event) => {
																changeComponent(configuredIndex, { position: event.target.value });
															},
															children: Object.entries(POSITION_LABEL).map(([value, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value,
																children: label
															}, value))
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: PromptStudioView_module_css_default["field"],
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PromptStudioView_module_css_default["fieldLabel"],
															children: "角色"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
															className: PromptStudioView_module_css_default["select"],
															value: component.role,
															disabled: !remote.writable,
															onChange: (event) => {
																changeRole(configuredIndex, event.target.value);
															},
															children: Object.entries(ROLE_LABEL).map(([value, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value,
																children: label
															}, value))
														})]
													}),
													component.role === "assistant" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: PromptStudioView_module_css_default["field"],
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PromptStudioView_module_css_default["fieldLabel"],
															children: "块类型"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
															className: PromptStudioView_module_css_default["select"],
															value: component.blockType ?? "text",
															disabled: !remote.writable,
															onChange: (event) => {
																changeComponent(configuredIndex, { blockType: event.target.value });
															},
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: "text",
																children: "文本"
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: "reasoning",
																children: "思考"
															})]
														})]
													}) : null,
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: PromptStudioView_module_css_default["field"],
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PromptStudioView_module_css_default["fieldLabel"],
															children: "覆盖目标"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
															className: PromptStudioView_module_css_default["select"],
															value: component.origin ?? "",
															disabled: !remote.writable,
															onChange: (event) => {
																changeOrigin(configuredIndex, event.target.value);
															},
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: "",
																children: "不覆盖原生"
															}), remote.native.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: item.id,
																children: item.id
															}, item.id))]
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														className: `${PromptStudioView_module_css_default["field"]} ${PromptStudioView_module_css_default["templateField"]}`,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PromptStudioView_module_css_default["fieldLabel"],
															children: "模板"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
															className: PromptStudioView_module_css_default["textarea"],
															value: component.template,
															disabled: !remote.writable,
															rows: 8,
															onChange: (event) => {
																changeComponent(configuredIndex, { template: event.target.value });
															}
														})]
													})
												]
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: PromptStudioView_module_css_default["excerpt"],
												children: component.template || "（空模板）"
											})
										]
									}, `${component.kind}:${component.id}:${String(configuredIndex)}`);
								})
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: PromptStudioView_module_css_default["previewColumn"],
							"aria-label": "完整请求预览",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PromptStudioView_module_css_default["sectionHeading"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										className: PromptStudioView_module_css_default["subtitle"],
										children: "完整预览"
									}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: PromptStudioView_module_css_default["count"],
										children: String(preview.length)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: PromptStudioView_module_css_default["assemblyOrder"],
									children: preview.map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: PromptStudioView_module_css_default["assemblyRow"],
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PromptStudioView_module_css_default["assemblyIndex"],
												children: String(index + 1)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: block.kind === "system" ? "system" : block.kind === "captured" ? "自动捕获" : "补充" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PromptStudioView_module_css_default["assemblyOrderValue"],
												children: block.label ?? (block.kind === "system" ? `${String(draftSystem.length)} 个 section 合并` : "")
											})
										]
									}, `layout:${block.kind}:${block.id ?? "system"}:${String(index)}`))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: PromptStudioView_module_css_default["preview"],
									children: preview.map((block, index) => block.kind === "system" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										className: PromptStudioView_module_css_default["previewSystem"],
										children: block.text
									}, `system:${index}`) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: block.kind === "captured" ? PromptStudioView_module_css_default["previewCaptured"] : PromptStudioView_module_css_default["previewSupplement"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PromptStudioView_module_css_default["previewSupplementTag"],
											children: block.kind === "captured" ? block.label : "补充"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
											className: PromptStudioView_module_css_default["previewSupplementText"],
											children: block.text
										})]
									}, `${block.kind}:${block.id}:${index}`))
								})
							]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Cordis services read by the registrations and the pushed invalidations. */
		const inject = [
			"slots",
			"conversation",
			"connection",
			"remote"
		];
		/** Register the tab, its shared controller, and pushed invalidations. */
		function apply(ctx) {
			const faces = /* @__PURE__ */ new Map();
			const faceFor = (sessionId) => {
				const key = sessionId ?? "";
				let face = faces.get(key);
				if (face !== void 0) return face;
				const controller = new PromptStudioStore(key.length === 0 ? void 0 : key);
				face = {
					controller,
					hooks: { snapshot: controller.store }
				};
				faces.set(key, face);
				return face;
			};
			ctx.effect(() => {
				const refresh = () => {
					for (const { controller } of faces.values()) refreshIfLoaded(controller);
				};
				const disposers = [ctx.remote.$on("settings/document-updated", (namespace) => {
					if (namespace === "prompt-studio") refresh();
				}), ctx.on("connection/reset", refresh)];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "ui-prompt-studio: pushed invalidations");
			ctx.slots.register({
				name: "conversation.view",
				id: "prompt-studio",
				order: 20,
				label: "Prompt Studio",
				inject: (sessionId) => faceFor(sessionId)
			}, PromptStudioView);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "prompt-studio",
				order: 20,
				label: "Prompt Studio",
				inject: () => faceFor()
			}, PromptStudioSettingsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map