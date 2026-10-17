import type { TextAnnotation } from "./TextAnnotation.js";

// Serialized n-ary annotation relationship at persistence and IPC boundaries.
export interface TextRelationshipSnapshot
{
	readonly id: string;
	readonly annotationIds: readonly string[];
}

// Groups two or more TextAnnotations without imposing direction or member roles.
export class TextRelationship
{
	public readonly id: string;
	public readonly elements: readonly TextAnnotation[];

	public constructor(id: string, elements: readonly TextAnnotation[])
	{
		const annotationsById = new Map<string, TextAnnotation>();

		for (const element of elements)
		{
			annotationsById.set(element.id, element);
		}

		const uniqueElements = [...annotationsById.values()];

		if (uniqueElements.length < 2)
		{
			throw new Error("A text relationship requires at least two annotations");
		}

		this.id = id;
		this.elements = uniqueElements;
	}

	// Creates a relationship from live annotations while persisting only stable identities.
	public static FromAnnotations(id: string, annotations: readonly TextAnnotation[]): TextRelationship
	{
		const relationship = new TextRelationship(id, annotations);

		return relationship;
	}

	// Determines whether this relationship contains an annotation identity.
	public Includes(annotationId: string): boolean
	{
		const includes = this.elements.some(function HasAnnotation(element): boolean
		{
			return element.id === annotationId;
		});

		return includes;
	}

	// Produces the explicit serialized representation of this relationship.
	public ToSnapshot(): TextRelationshipSnapshot
	{
		const snapshot: TextRelationshipSnapshot = {
			id: this.id,
			annotationIds: this.elements.map(function GetAnnotationId(element): string
			{
				return element.id;
			})
		};

		return snapshot;
	}
}
