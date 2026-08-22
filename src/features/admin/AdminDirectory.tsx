import type {
  ReactTable,
  Row,
  RowData,
  TableFeatures,
  TableState,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { Button, Group, Text, Title } from "#/features/shared/mantine";
import classes from "./AdminDirectory.module.css";

interface DirectoryPagination {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
}

export function AdminDirectory<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = TableState<TFeatures>,
>({
  caption,
  children,
  countNames,
  emptyText,
  navigating,
  numericColumns,
  onPageChange,
  pagination,
  renderExpandedRow,
  table,
  title,
  eyebrow,
}: {
  caption: string;
  children: ReactNode;
  countNames: { singular: string; plural: string };
  emptyText: string;
  eyebrow: string;
  navigating: boolean;
  numericColumns?: ReadonlySet<string>;
  onPageChange: (page: number) => void;
  pagination: DirectoryPagination;
  renderExpandedRow?: (row: Row<TFeatures, TData>) => ReactNode;
  table: ReactTable<TFeatures, TData, TSelected>;
  title: string;
}) {
  const name = pagination.total === 1 ? countNames.singular : countNames.plural;
  return (
    <section className={classes.root} aria-labelledby="admin-directory-heading">
      <AdminDirectoryHeader
        headingId="admin-directory-heading"
        title={title}
        eyebrow={eyebrow}
        count={`${String(pagination.total)} ${name}`}
      />
      {children}
      <AdminDirectoryResults
        caption={caption}
        emptyText={emptyText}
        loading={navigating}
        numericColumns={numericColumns}
        onPageChange={onPageChange}
        pagination={pagination}
        renderExpandedRow={renderExpandedRow}
        table={table}
      />
    </section>
  );
}

export function AdminDirectoryHeader({
  count,
  eyebrow,
  headingId,
  order = 1,
  title,
}: {
  count: string;
  eyebrow?: string;
  headingId: string;
  order?: 1 | 2;
  title: string;
}) {
  return (
    <header className={classes.header}>
      <div>
        {eyebrow ? (
          <Text c="indigo.7" fw={700}>
            {eyebrow}
          </Text>
        ) : null}
        <Title order={order} id={headingId}>
          {title}
        </Title>
      </div>
      <span className={classes.count}>{count}</span>
    </header>
  );
}

export function AdminDirectoryResults<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = TableState<TFeatures>,
>({
  caption,
  emptyText,
  loading = false,
  numericColumns,
  onPageChange,
  pagination,
  renderExpandedRow,
  table,
}: {
  caption: string;
  emptyText: string;
  loading?: boolean;
  numericColumns?: ReadonlySet<string> | undefined;
  onPageChange: (page: number) => void;
  pagination: DirectoryPagination;
  renderExpandedRow?: ((row: Row<TFeatures, TData>) => ReactNode) | undefined;
  table: ReactTable<TFeatures, TData, TSelected>;
}) {
  const rowCount = table.getRowModel().rows.length;
  const first =
    pagination.total === 0
      ? 0
      : pagination.pageSize * (pagination.page - 1) + 1;
  const last = rowCount ? first + rowCount - 1 : 0;
  return (
    <>
      <Text c="dimmed" size="sm" role="status">
        Showing {first}–{last} of {pagination.total}
      </Text>
      {rowCount ? (
        <ResponsiveDataTable
          table={table}
          caption={caption}
          numericColumns={numericColumns}
          renderExpandedRow={renderExpandedRow}
        />
      ) : loading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <p className={classes.empty}>{emptyText}</p>
      )}
      {pagination.pages > 1 ? (
        <Group justify="space-between" className={classes.pagination}>
          <Button
            variant="light"
            disabled={pagination.page === 1 || loading}
            onClick={() => {
              onPageChange(pagination.page - 1);
            }}
          >
            Previous
          </Button>
          <Text size="sm">
            Page {pagination.page} of {pagination.pages}
          </Text>
          <Button
            variant="light"
            disabled={pagination.page === pagination.pages || loading}
            onClick={() => {
              onPageChange(pagination.page + 1);
            }}
          >
            Next
          </Button>
        </Group>
      ) : null}
    </>
  );
}

export function AdminDirectorySearch({
  label,
  navigating = false,
  onSubmit,
  placeholder,
  query,
  secondary,
  submitLabel,
}: {
  label: string;
  navigating?: boolean;
  onSubmit: (form: FormData) => void;
  placeholder: string;
  query: string;
  secondary?: ReactNode;
  submitLabel: string;
}) {
  return (
    <form
      className={classes.searchForm}
      data-secondary={Boolean(secondary) || undefined}
      action={onSubmit}
    >
      <MantineTextInput
        name="q"
        label={label}
        defaultValue={query}
        placeholder={placeholder}
        maxLength={100}
      />
      {secondary}
      <Button type="submit" loading={navigating}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function AdminDirectoryFilters({ children }: { children: ReactNode }) {
  return (
    <div className={classes.filters}>
      <Text size="sm" fw={700}>
        Current filters
      </Text>
      <Group gap="xs">{children}</Group>
    </div>
  );
}
