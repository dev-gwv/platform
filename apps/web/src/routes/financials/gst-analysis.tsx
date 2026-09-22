import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useGstAnalysis } from '@/features/gst-analysis/api'
import { ErrorState } from '@/shared/ui/states'
import { TrendingUp, TrendingDown, Receipt, Calculator, FileText } from 'lucide-react'

function GstAnalysisContent() {
  const today = new Date()
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)

  const [startDate, setStartDate] = useState(firstDay)
  const [endDate, setEndDate] = useState(lastDay)

  const { data, isLoading, isError, refetch } = useGstAnalysis(startDate, endDate)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="GST Analysis" description="GST liability and input tax credit analysis" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="GST Analysis"
        description="GST liability and input tax credit analysis"
        actions={
          <div className="no-print">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <FileText className="mr-1 h-4 w-4" /> Print
            </Button>
          </div>
        }
      />

      {/* Date Range Filter. The dates are already stated on the figures
          below, so the pickers themselves are noise on paper. */}
      <Card className="no-print">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-sm font-medium">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isError && !isLoading && (
        <Card>
          <CardContent className="py-2">
            <ErrorState message="We could not work out the GST for this period." onRetry={() => void refetch()} />
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Total Income" value={`₹${data.total_income.toLocaleString()}`} icon={TrendingUp} />
            <StatCard label="GST Collected" value={`₹${data.gst_collected.toLocaleString()}`} icon={Receipt} />
            <StatCard label="Input Tax Credit" value={`₹${data.input_tax_credit.toLocaleString()}`} icon={Calculator} />
            <StatCard
              label="Net GST Liability"
              value={`₹${data.net_gst_liability.toLocaleString()}`}
              icon={TrendingDown}
              className={data.net_gst_liability > 0 ? 'text-red-600' : 'text-green-600'}
            />
            {/* Computed by the RPC and part of the contract, but previously not
                shown anywhere on the page. */}
            <StatCard label="Reverse Charge" value={`₹${data.reverse_charge.toLocaleString()}`} icon={FileText} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* By GST Rate */}
            <Card>
              <CardHeader>
                <CardTitle>Breakdown by GST Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Rate</th>
                        <th className="pb-2 text-right font-medium">Taxable</th>
                        <th className="pb-2 text-right font-medium">CGST</th>
                        <th className="pb-2 text-right font-medium">SGST</th>
                        <th className="pb-2 text-right font-medium">IGST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_gst_rate.map((r) => (
                        <tr key={r.rate} className="border-b last:border-0">
                          <td className="py-2 font-medium">{r.rate}%</td>
                          <td className="py-2 text-right">₹{r.taxable_amount.toLocaleString()}</td>
                          <td className="py-2 text-right">₹{r.cgst.toLocaleString()}</td>
                          <td className="py-2 text-right">₹{r.sgst.toLocaleString()}</td>
                          <td className="py-2 text-right">₹{r.igst.toLocaleString()}</td>
                        </tr>
                      ))}
                      {data.by_gst_rate.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-muted-foreground">No data for this period.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* By State */}
            <Card>
              <CardHeader>
                <CardTitle>Breakdown by State</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.by_state.map((s) => (
                    <div key={s.state} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{s.state}</p>
                        <p className="text-xs text-muted-foreground">Income: ₹{s.income.toLocaleString()}</p>
                      </div>
                      <p className="font-medium">GST: ₹{s.gst.toLocaleString()}</p>
                    </div>
                  ))}
                  {data.by_state.length === 0 && (
                    <p className="py-4 text-center text-muted-foreground">No data for this period.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>GST Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">GST Collected (Output Tax)</p>
                  <p className="text-xl font-semibold">₹{data.gst_collected.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">GST Paid (Input Tax)</p>
                  <p className="text-xl font-semibold">₹{data.gst_paid.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Net GST Liability</p>
                  <p className={`text-xl font-semibold ${data.net_gst_liability > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    ₹{data.net_gst_liability.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export function GstAnalysisPage() {
  return (
    <AuthedPage module="financials">
      <GstAnalysisContent />
    </AuthedPage>
  )
}
