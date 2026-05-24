import { ReservationDetail } from "@/components/reservation-detail";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ReservationPage({ params }: PageProps) {
  const { id } = await params;
  return <ReservationDetail reservationId={id} />;
}
