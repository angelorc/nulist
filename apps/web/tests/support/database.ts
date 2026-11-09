/** Connection string of the disposable test database (never the dev database). */
export const TEST_DATABASE_URL =
  process.env.MLIST_TEST_DATABASE_URL || 'postgres://mlist:mlist@127.0.0.1:5442/mlist_test'

if (!/\/[^/]*test[^/]*$/.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error(
    `Refusing to run the test-suite against "${TEST_DATABASE_URL}": the database name must contain "test".`
  )
}
