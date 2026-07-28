import CustomerOverview from "@/components/platform/CustomerOverview";

export default async function PlatformCustomerDetailPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <CustomerOverview companyId={companyId} />;
}
