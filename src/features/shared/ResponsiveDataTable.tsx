import type {
  ReactTable,
  RowData,
  TableFeatures,
  TableState,
} from "@tanstack/react-table";
import classes from "./ResponsiveDataTable.module.css";

export function ResponsiveDataTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = TableState<TFeatures>,
>({
  table,
  caption,
  numericColumns,
}: {
  table: ReactTable<TFeatures, TData, TSelected>;
  caption: string;
  numericColumns?: ReadonlySet<string>;
}) {
  return (
    <div className={classes.region}>
      <table className={classes.table}>
        <caption className={classes.caption}>{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  scope="col"
                  key={header.id}
                  data-numeric={
                    numericColumns?.has(header.column.id) || undefined
                  }
                >
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => {
                const header = cell.column.columnDef.header;
                const label = typeof header === "string" ? header : "Value";
                return (
                  <td
                    key={cell.id}
                    data-label={label}
                    data-numeric={
                      numericColumns?.has(cell.column.id) || undefined
                    }
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
