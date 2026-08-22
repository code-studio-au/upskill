import type {
  ReactTable,
  Row,
  RowData,
  TableFeatures,
  TableState,
} from "@tanstack/react-table";
import { Fragment, type ReactNode } from "react";
import classes from "./ResponsiveDataTable.module.css";

export function ResponsiveDataTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = TableState<TFeatures>,
>({
  table,
  caption,
  numericColumns,
  renderExpandedRow,
}: {
  table: ReactTable<TFeatures, TData, TSelected>;
  caption: string;
  numericColumns?: ReadonlySet<string> | undefined;
  renderExpandedRow?: ((row: Row<TFeatures, TData>) => ReactNode) | undefined;
}) {
  return (
    <div className={classes.region}>
      <table className={classes.table}>
        <caption className={classes.caption}>{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {renderExpandedRow ? (
                <th scope="col" data-expander aria-label="Details" />
              ) : null}
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
          {table.getRowModel().rows.map((row) => {
            return (
              <Fragment key={row.id}>
                <tr>
                  {renderExpandedRow ? (
                    <td data-label="Details" data-expander>
                      <label className={classes.expander}>
                        <input
                          type="checkbox"
                          className={classes.expanderInput}
                          aria-label="Toggle row details"
                        />
                      </label>
                    </td>
                  ) : null}
                  {row.getAllCells().map((cell) => {
                    const header = cell.column.columnDef.header;
                    const cellLabel =
                      typeof header === "string" ? header : "Value";
                    return (
                      <td
                        key={cell.id}
                        data-label={cellLabel}
                        data-numeric={
                          numericColumns?.has(cell.column.id) || undefined
                        }
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
                {renderExpandedRow ? (
                  <tr data-expanded-row>
                    <td colSpan={row.getAllCells().length + 1}>
                      {renderExpandedRow(row)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
