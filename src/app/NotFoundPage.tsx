import { Link } from 'react-router';

import { PageHeading } from './PageHeading';

export default function NotFoundPage() {
  return (
    <>
      <PageHeading title="Page not found" />
      <p className="max-w-prose">
        There is no page at this address. Use the navigation above, or go to the{' '}
        <Link to="/" className="underline">
          overview
        </Link>
        .
      </p>
    </>
  );
}
