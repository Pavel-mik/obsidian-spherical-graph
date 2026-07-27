import { describe, expect, it } from "vitest";

import {
	GraphDataService,
	normalizeGraphTags,
} from "../../src/graph/GraphDataService";
import {
	GraphDataSource,
	AttachmentGraphFile,
	MarkdownGraphFile,
	ResolvedLinkIndex,
} from "../../src/graph/graphTypes";

class MutableGraphSource implements GraphDataSource {
	files: MarkdownGraphFile[];
	resolvedLinks: ResolvedLinkIndex;
	attachments: AttachmentGraphFile[] = [];
	unresolvedLinks: ResolvedLinkIndex = {};

	constructor(
		files: MarkdownGraphFile[],
		resolvedLinks: ResolvedLinkIndex,
	) {
		this.files = files;
		this.resolvedLinks = resolvedLinks;
	}

	getMarkdownFiles(): readonly MarkdownGraphFile[] {
		return this.files;
	}

	getResolvedLinks(): ResolvedLinkIndex {
		return this.resolvedLinks;
	}

	getAttachmentFiles(): readonly AttachmentGraphFile[] {
		return this.attachments;
	}

	getUnresolvedLinks(): ResolvedLinkIndex {
		return this.unresolvedLinks;
	}
}

function file(path: string): MarkdownGraphFile {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return {
		path,
		basename: name.endsWith(".md") ? name.slice(0, -3) : name,
	};
}

describe("GraphDataService", () => {
	it("builds deterministic nodes and combines directed resolved links", () => {
		const source = new MutableGraphSource(
			[file("z.md"), file("folder/b.md"), file("a.md")],
			{
				"z.md": { "a.md": 2, "z.md": 20 },
				"a.md": { "z.md": 3, "folder/b.md": 1 },
				"folder/b.md": { "a.md": 4 },
			},
		);
		const graph = new GraphDataService(source).buildGraph();

		expect(graph.nodes.map((node) => node.path)).toEqual([
			"a.md",
			"folder/b.md",
			"z.md",
		]);
		expect(graph.nodes.map((node) => node.index)).toEqual([0, 1, 2]);
		expect(graph.edges).toEqual([
			{
				source: 0,
				target: 1,
				weight: 5,
				forwardWeight: 1,
				backwardWeight: 4,
			},
			{
				source: 0,
				target: 2,
				weight: 5,
				forwardWeight: 3,
				backwardWeight: 2,
			},
		]);
		expect(graph.nodes[0]).toMatchObject({
			degree: 2,
			weightedDegree: 10,
		});
		expect(graph.nodes[1]).toMatchObject({
			degree: 1,
			weightedDegree: 5,
		});
	});

	it("ignores self-links, unresolved paths, and invalid weights", () => {
		const source = new MutableGraphSource(
			[file("a.md"), file("b.md")],
			{
				"a.md": {
					"a.md": 1,
					"b.md": Number.NaN,
					"ghost.md": 5,
				},
				"b.md": { "a.md": 0 },
			},
		);
		const graph = new GraphDataService(source).buildGraph();
		expect(graph.edges).toEqual([]);
		expect(graph.nodes).toHaveLength(2);
	});

	it("filters excluded folder prefixes on segment boundaries", () => {
		const source = new MutableGraphSource(
			[
				file("private/a.md"),
				file("private-not/b.md"),
				file("root.md"),
			],
			{
				"private/a.md": { "root.md": 1 },
				"private-not/b.md": { "root.md": 2 },
			},
		);
		const graph = new GraphDataService(source).buildGraph({
			excludedFolderPrefixes: ["\\private\\"],
		});

		expect(graph.nodes.map((node) => node.path)).toEqual([
			"private-not/b.md",
			"root.md",
		]);
		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0]?.weight).toBe(2);
	});

	it("includes or excludes orphan notes without leaving sparse indices", () => {
		const source = new MutableGraphSource(
			[file("a.md"), file("b.md"), file("orphan.md")],
			{ "a.md": { "b.md": 1 } },
		);
		const service = new GraphDataService(source);

		expect(
			service.buildGraph({ includeOrphans: true }).nodes.map(
				(node) => node.path,
			),
		).toEqual(["a.md", "b.md", "orphan.md"]);
		const withoutOrphans = service.buildGraph({
			includeOrphans: false,
		});
		expect(withoutOrphans.nodes.map((node) => node.path)).toEqual([
			"a.md",
			"b.md",
		]);
		expect(withoutOrphans.nodes.map((node) => node.index)).toEqual([0, 1]);
	});

	it("produces the same descriptor and signature for reordered API data", () => {
		const first = new GraphDataService(
			new MutableGraphSource(
				[file("b.md"), file("a.md")],
				{
					"b.md": { "a.md": 2 },
					"a.md": { "b.md": 1 },
				},
			),
		).buildGraph();
		const second = new GraphDataService(
			new MutableGraphSource(
				[file("a.md"), file("b.md")],
				{
					"a.md": { "b.md": 1 },
					"b.md": { "a.md": 2 },
				},
			),
		).buildGraph();

		expect(second.descriptor).toEqual(first.descriptor);
		expect(second.signature).toBe(first.signature);
	});

	it("normalizes note tags without adding them to the layout signature", () => {
		expect(
			normalizeGraphTags([
				"project",
				"#Project",
				" #nested/design ",
				"",
			]),
		).toEqual(["#nested/design", "#project"]);

		const source = new MutableGraphSource(
			[
				{
					...file("a.md"),
					tags: ["project", "#Project", "#nested/design"],
				},
			],
			{},
		);
		const service = new GraphDataService(source);
		const first = service.buildGraph();
		source.files = [
			{ ...file("a.md"), tags: ["#different"] },
		];
		const second = service.buildGraph();

		expect(first.nodes[0]?.tags).toEqual([
			"#nested/design",
			"#project",
		]);
		expect(second.nodes[0]?.tags).toEqual(["#different"]);
		expect(second.signature).toBe(first.signature);
		expect(second.descriptor).toEqual(first.descriptor);
	});

	it("keeps attachments and unresolved targets outside the layout signature", () => {
		const source = new MutableGraphSource(
			[file("a.md"), file("b.md")],
			{
				"a.md": { "b.md": 1, "assets/map.png": 2 },
			},
		);
		source.attachments = [
			{ path: "assets/map.png", basename: "map" },
			{ path: "assets/orphan.pdf", basename: "orphan" },
		];
		source.unresolvedLinks = {
			"b.md": { "Missing note.md": 3 },
		};

		const graph = new GraphDataService(source).buildGraph();

		expect(graph.nodes.map((node) => node.id)).toEqual([
			"a.md",
			"b.md",
		]);
		expect(graph.auxiliaryNodes).toEqual([
			expect.objectContaining({
				id: "assets/map.png",
				kind: "attachment",
				degree: 1,
				weightedDegree: 2,
			}),
			expect.objectContaining({
				id: "assets/orphan.pdf",
				kind: "attachment",
				degree: 0,
			}),
			expect.objectContaining({
				id: "unresolved:Missing note.md",
				kind: "unresolved",
				degree: 1,
				weightedDegree: 3,
			}),
		]);
		expect(graph.auxiliaryEdges).toEqual([
			{
				sourceId: "a.md",
				targetId: "assets/map.png",
				weight: 2,
			},
			{
				sourceId: "b.md",
				targetId: "unresolved:Missing note.md",
				weight: 3,
			},
		]);

		source.attachments = [];
		source.unresolvedLinks = {};
		const withoutAuxiliary = new GraphDataService(
			source,
		).buildGraph();
		expect(withoutAuxiliary.signature).toBe(graph.signature);
		expect(withoutAuxiliary.descriptor).toEqual(graph.descriptor);
	});
});
