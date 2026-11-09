/** Methods other than GET, PATCH and DELETE on /api/v1/contacts/{email}. */
export default defineApiMethodFallback(['GET', 'PATCH', 'DELETE'])
