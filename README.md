# dsh-prompt-studio

Prompt Studio 的 DeepSeek Harness 插件分发形态。插件在对话页注册 **Prompt Studio** 标签页，以同一组件列表展示运行时原生提示词和用户补充，并提供编辑、原生覆盖与完整请求预览。

> **适配目标**：DeepSeek Harness `0.2.0-rc.2`（含 `0.2.x` 系列）。0.1.x 平台已被上游移除的包（`@deepseek-ai/dsh-client-web-react`、`@deepseek-ai/dsh-client-runtime`、`SettingsProvider`）不再被引用。

## 组件模型

每个编排项使用同一结构：

```ts
interface PromptComponent {
  id: string
  kind: 'native' | 'supplement'
  role: 'system' | 'user' | 'assistant'
  position?: 'after_system' | 'anchored' | 'tail'
  order: number
  enabled: boolean
  template: string
  origin?: string
}
```

这些字段分别描述不同维度，不以 `kind` 代替角色或用途：

- `kind` 只区分来源：`native` 是 Host 在运行时发现的只读组件；`supplement` 是用户可编排并持久化的补充组件。
- `role` 决定内容归宿：
  - `system` 一律注册为有序 system section，最终与原生 sections 合并到全局唯一的 `system` 字段；此时不得设置 `position`；
  - `user`、`assistant` 进入请求的运行时上下文快照（见下），必须设置 `position`。
- `position` 只描述 message 补充在运行时上下文快照中的相对位置：`after_system` 在最前，`anchored`、`tail` 依次靠后；相同 `position` 内按 `order` 升序。
- `order` 有两种与归宿对应的含义：
  - system 组件的 `order` 是 system section 的全局混排层级，和原生 sections 一起升序排列；约定 `-100` 是身份区、`0` 是 persona、`100–199` 是工具区，其他负值也在 persona 之前；
  - message 组件的 `order` 只在同一个 `position` 间隙内排序，不参与跨间隙比较。
- `origin` 只用于覆盖。补充组件未设置 `origin` 时是普通注入；设置为某个原生组件 id 时，同一个补充组件即覆盖该原生组件，不存在单独的覆盖 kind。

## 内容合并

所有 system sections 最终渲染为同一个 `system` 字符串，补充内容以纯文本直接并入，不加任何包装标记。

`user`/`assistant` 补充通过 `systemPrompt.context()` 注册为**有序运行时上下文**。Harness 会把全部上下文折叠为一条持久化的 user-role 快照，随每次请求写入会话日志。这类内容不属于对话消息序列，因此不会伪造模型回合，也不会改动会话状态机。

> 与 v0.4.0 的差异：v0.4.0 曾把 user/assistant 补充折叠成 `session/created` 上的合成种子回合。0.2.x 的会话契约要求 `assistant/message` 必须携带真实 model source 与完整模型流，并校验回合/步骤配对；合成回合会被拒绝，且会让会话停留在未闭合回合上。因此本版本改用官方上下文通道，语义与位置顺序保持不变。

## 原生覆盖

覆盖仍使用有序 marker section 和 `system-prompt/assemble` waterfall，不依赖静态原生目录：

1. `origin` 指向当前组装中存在的原生组件时，waterfall 移除原始组件。
2. 覆盖组件启用时，其替换文本按自身 `role` 归宿：system 覆盖保留 marker 的全局 `order` 并进入唯一 system 字段；user/assistant 覆盖进入运行时上下文。
3. 覆盖组件设为 `enabled=false` 时只移除原始组件，相当于关闭该原生组件。
4. `origin` 在本次组装中不存在时，不会凭空生成替换内容。

## 运行时组装

配置集合由 `ComponentPipeline` 激活。每次设置变更先调用旧组合效果的 disposer，再把新集合施加为一个 Cordis 生成器效果；marker、覆盖映射与补充上下文分别返回原子逆，组合逆由 `ctx.effect()` 按结构生成。

原生目录在运行时动态发现。插件监听 `system-prompt/change` 并重新执行真实 `systemPrompt.assemble()`；waterfall 在覆盖前捕获原生 name、text 与组装次序，在覆盖后捕获实际 system 槽序列。浏览器通过同源 `GET /prompt-studio/state` 读取该单值快照。

system 补充直接通过 `systemPrompt.section()` 参与真实组装；user/assistant 补充通过 `systemPrompt.context()` 参与真实组装。两条路径都进入模型可见的请求内容，并保持「模型可见 ⟺ 会话日志可重建」这一上游不变量。

## 自动捕获注入上下文

请求发出前，插件扫描完整请求消息序列，自动识别所有「非对话」消息——即生产者注入的上下文（`MessageSource.kind` 既不是 `user`/`model`/`tool`）——并纳入 Prompt Studio 视野，无需预知注入者是谁。任何插件将来注入的新上下文都会自动出现，不需要为它单独加桥。

捕获按消息来源分类（`form`：instructions / catalog / snapshot / notice / relay / recall）。workspace-context 注入的指令（AGENTS.md 基线及其动态增量）会进一步展开为资源条目：每个文件显示路径、动作（set/replace/remove）与内容摘要，`remove` 之外的资源可打开编辑。编辑通过资源读写接口写回文件系统，写回带版本冲突检测——文件在捕获后被修改时会拒绝覆盖并返回冲突，避免与 workspace-context 自身的状态协调（版本缓存、reconcile、字节预算）打架。

捕获是请求级快照：仅当会话发生过模型请求时，面板中才出现捕获条目。

## 模板变量

system 组件模板支持 `{{user_input}}` 引用，即当前会话最后一条真实用户输入。该值在每次组装时从 `AssembleContext.agent` 读取（`session.deriveMessages()` 派生历史），不是保存时快照。

## 设置

配置是插件自己的 **profile 条目 Config**：`package.json` 的 `Config` 导出（`src/config.ts`）声明 schema，`components` 字段标记为 `volatile()`，因此编辑在条目重挂载之外原地生效。持久化位置是当前 profile 的 patch 层：

```yaml
- id: prompt-studio
  name: dsh-prompt-studio
  config:
    components:
      - id: supplement:identity
        kind: supplement
        role: system
        order: -200
        enabled: true
        template: 你是一个严谨的工程助手。
      - id: supplement:message
        kind: supplement
        role: user
        position: tail
        order: 100
        enabled: true
        template: 请先复述当前目标。
```

运行时原生组件不写入配置。

浏览器读写走插件自己的端点：

- `GET /prompt-studio/settings` → `{ writable, revision, value }`
- `POST /prompt-studio/settings` → `{ components, expectedRevision }`，由 `ctx.settings.replace('prompt-studio', …)` 落盘，过期 revision 返回 409
- `GET /prompt-studio/state[?sessionId=…]` → 运行时目录快照
- `GET|POST /prompt-studio/resource` → 捕获项文件读写

## 使用

1. 打开任意对话，选择 **Prompt Studio** 标签页。
2. 选择 **新增补充**，分别编辑标识、角色、顺序、可选覆盖目标与模板；只有 user/assistant 角色显示消息间隙选择器。
3. 如需覆盖原生组件，也可在对应原生行选择 **创建覆盖**；生成的仍是 `kind=supplement` 组件，只是带有 `origin`。
4. 在 **完整预览** 中检查合并后的完整 system 内容及各消息间隙的补充内容。模型内容预览不插入 `[位置 · role · id]` 一类展示标签，补充内容以纯文本直接注入。
5. 选择 **保存更改**。设置保存后立即撤销旧组合并施加新组合。

## 安装与启用

Prompt Studio 以**组合包（bundle）**分发：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，`dsh.client` 声明浏览器端注入面。安装进一个 profile：

```sh
# 先完成构建（见下），再安装到 profile（profile 名可自取，例如 web）
dsh plugin --profile web add /path/to/dsh-prompt-studio
dsh --profile web --dump-config   # 应能看到 "# == dsh-prompt-studio" 层
dsh web                           # 或 dsh --profile web
```

`dsh plugin --profile <name> add <path>` 会把包链接进 profile 并把包名追加进 `dsh.profile.bundles`。已安装的 bundle 通过 `dsh plugin --profile <name> remove dsh-prompt-studio` 移除。命令行与已经运行的 Web 进程不共享内存，因此替换插件产物后需重启 `dsh web` 并刷新浏览器。

`dsh.client` 只声明 `platform: 'web'`：

- 不声明 `inject`：客户端产物只请求平台模块表的基础行，不需要任何动态 provider 行先到；
- 不声明 `external`：`external` 不是功能插件的依赖机制，本插件不请求任何非基础模块。
- `peerDependencies` 声明运行时依赖的 DSH 平台包版本区间，宿主启动时会据此校验兼容性并拒绝不兼容的版本。

## 构建

构建依赖两样东西：本包自己已安装的依赖（平台类型、React、测试工具），以及一个已安装依赖的 DSH 源码树（提供客户端打包预设与 `tsc`/`tsdown` 二进制）。

```sh
pnpm install
DSH_ROOT=/path/to/dsh node scripts/build.mjs
```

构建先运行 TypeScript 声明产出与类型检查（`tsc -p tsconfig.json` → `lib/types`），再由 `tsdown` 生成自包含的服务端 ESM 与浏览器端 bundle，最后写入插件根目录：

- `index.mjs`
- `client.js`
- `client.js.map`
- `lib/types/**`（发布用类型）

`tsdown.config.ts` 用 `DSH_ROOT` 的**真实绝对路径**动态导入客户端打包预设（`$DSH_ROOT/packages/client/tsdown.client.ts`），因此构建不需要在插件里建立任何 `./.dsh` 链接——Windows 上既不需要管理员权限，也不需要开发者模式。

`scripts/dsh-env.mjs` 在构建期间只向 DSH 源码树写入一处**临时清单投影**：`$DSH_ROOT/packages/_plugin-build/dsh-prompt-studio/package.json`（预设按 `packages/*/*/package.json` 查找包清单，而本插件不在该工作区内）。它是普通文件复制，构建结束后在 `finally` 中删除；只有构建被强杀时才可能残留，删掉该目录即可。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 包名（唯一权威 id）、`dsh.bundle.patch` 与 `dsh.client` 声明、peer/dev 依赖 |
| `cordis.patch.yml` | 组合层：把包名插入 profile 的 patch 列表（`id: prompt-studio`） |
| `src/index.ts` | 效果管线、动态目录、原生覆盖与运行时上下文 |
| `src/config.ts` | 插件 `Config` schema（`components` 为 volatile 字段） |
| `src/shared.ts` | 二分组件模型、校验、覆盖判定与预览函数 |
| `src/client/` | 统一列表编辑器、运行时目录读取与设置保存 |
| `tests/registry-artifacts.spec.ts` | 产物契约：模块表请求、slot 注册、Node 端自包含 |
| `scripts/build.mjs` | 声明产出、类型检查与双端构建 |

## 平台契约

客户端产物通过 `window.__ModuleLoader__.load({ id, factory })` 注册，`id` 必须是包名 `dsh-prompt-studio`。factory 只用 `require()` 解析平台模块表的基础行：

- `react`、`react/jsx-runtime`
- `@deepseek-ai/dsh-client-store`（快照 store 引擎）

组件侧通过 slot 注册的保留 `hooks` 隔间获得响应式读取：注册时提供 `hooks: { snapshot: controller.store }`，渲染器把它绑定成组件的 `useSnapshot` 选择器 hook，业务组件因此不引入任何订阅机制或跨插件值依赖。

## 已知前提

- 插件按 profile 条目 id `prompt-studio` 读写自己的配置。若把 `cordis.patch.yml` 的 `id` 改成别的名字，需要同步 `src/shared.ts` 的 `PROMPT_STUDIO_NAMESPACE`。
- `/prompt-studio/*` HTTP 端点注册在 `webServer` 服务上，仅在 Web 组合下可用；无 Web 时插件仍可正常加载，只是不提供 HTTP 端点与浏览器标签页。
- 设置页内的排版优化（上游 issue #2）尚未处理。
