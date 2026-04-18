export class RemoteSchemaNormalizer {
  public static normalize(definitions: any[]): any[] {
    return definitions.map((def) => {
      if (def.columns) {
        return {
          ...def,
          columns: def.columns.map((col: any) => ({
            ...col,
            type: typeof col.type === "string" ? col.type : col.type.toJSON(),
          })),
        };
      }
      return def;
    });
  }
}
