import { MyPay } from '@/components/MyPay';

/**
 * A driver, a guard or a librarian reads their payslip here. Same component
 * as the teacher's, because the question is the same one.
 */
export default function WorkerSalary() {
  return <MyPay />;
}
