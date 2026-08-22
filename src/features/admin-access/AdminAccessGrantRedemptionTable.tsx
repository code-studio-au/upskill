import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatLocalDate } from "#/features/shared/local-date";
import { Button, Group, Text } from "#/features/shared/mantine";
import { getAdminAccessGrantRedemptions } from "#/server/functions/admin-access-grant";
import type { AdminAccessGrantRedemptionPage } from "./admin-access.schema";
import classes from "./AdminAccessGrantRedemptionTable.module.css";

export function AdminAccessGrantRedemptionTable({
  accessGrantId,
  expectedTotal,
}: {
  accessGrantId: string;
  expectedTotal: number;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminAccessGrantRedemptionPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void getAdminAccessGrantRedemptions({
      data: { accessGrantId, page },
    })
      .then((response) => {
        if (!active) return;
        if (response.status !== "ready") {
          setError(true);
          return;
        }
        setResult(response.data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessGrantId, page]);

  const total = result?.total ?? expectedTotal;
  const pageSize = result?.pageSize ?? 100;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  if (total === 0 && !loading)
    return (
      <Text size="sm" c="dimmed">
        No redemptions yet.
      </Text>
    );

  function moveToPage(nextPage: number): void {
    setLoading(true);
    setError(false);
    setPage(nextPage);
  }

  return (
    <div className={classes.table}>
      <div className={classes.viewport} aria-busy={loading}>
        <table className={classes.dataTable} aria-rowcount={total + 1}>
          <thead>
            <tr className={classes.header}>
              <th scope="col">Learner</th>
              <th scope="col">Status</th>
              <th scope="col">Enrolled</th>
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((row, index) => (
              <tr
                className={classes.row}
                key={row.enrollmentId}
                aria-rowindex={(page - 1) * pageSize + index + 2}
              >
                <td className={classes.learner}>
                  <Link
                    to="/admin/learners/$userId/enrollments/$enrollmentId"
                    params={{
                      userId: row.learnerId,
                      enrollmentId: row.enrollmentId,
                    }}
                  >
                    {row.learnerName}
                  </Link>
                  <small>{row.learnerEmail}</small>
                </td>
                <td>{row.state}</td>
                <td>{formatLocalDate(row.enrolledAt)}</td>
              </tr>
            ))}
            {loading ? (
              <tr className={classes.row}>
                <td className={classes.loading} colSpan={3}>
                  Loading redemptions…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {error ? (
        <Text className={classes.error} c="red" size="sm">
          Redemptions could not be loaded.
        </Text>
      ) : null}
      {pageCount > 1 ? (
        <Group className={classes.pagination} justify="space-between" gap="sm">
          <Button
            size="xs"
            variant="light"
            disabled={page <= 1 || loading}
            onClick={() => {
              moveToPage(page - 1);
            }}
          >
            Previous
          </Button>
          <Text size="sm" c="dimmed">
            Page {page} of {pageCount}
          </Text>
          <Button
            size="xs"
            variant="light"
            disabled={page >= pageCount || loading}
            onClick={() => {
              moveToPage(page + 1);
            }}
          >
            Next
          </Button>
        </Group>
      ) : null}
    </div>
  );
}
