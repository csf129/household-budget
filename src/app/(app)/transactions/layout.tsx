export default function TransactionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="pb-8 sm:pb-10">
      {children}
    </div>
  );
}
