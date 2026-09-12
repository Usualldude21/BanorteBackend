import { type UiDataSource, type UiDocument } from "../dsl/ui.schema.js";

export interface UiGenerationInput {
  query: string;
  answer: string;
  dataSources: UiDataSource[];
}

export interface UiGenerator {
  generate(input: UiGenerationInput, signal?: AbortSignal): Promise<UiDocument>;
}
