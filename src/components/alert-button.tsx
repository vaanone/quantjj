"use client";

import { useState } from "react";
import { Bell, Plus, Trash2, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { PriceAlert } from "@/hooks/use-price-alerts";

interface AlertButtonProps {
  symbol: string;
  currentPrice: number;
  alerts: PriceAlert[];
  onAddAlert: (price: number) => void;
  onRemoveAlert: (id: string) => void;
  onClearAll: () => void;
}

export function AlertButton({
  symbol,
  currentPrice,
  alerts,
  onAddAlert,
  onRemoveAlert,
  onClearAll,
}: AlertButtonProps) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");

  const activeAlerts = alerts.filter((a) => a.symbol === symbol && !a.triggered);
  const triggeredAlerts = alerts.filter((a) => a.symbol === symbol && a.triggered);

  const handleAdd = () => {
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return;
    onAddAlert(p);
    setPrice("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-8 gap-1.5 px-2 text-white/60 hover:bg-white/10 hover:text-white"
          title="Set price alert"
        >
          {activeAlerts.length > 0 ? (
            <BellRing className="h-4 w-4 text-red-400" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          {activeAlerts.length > 0 && (
            <Badge className="ml-0.5 h-4 px-1 text-[9px] font-mono">{activeAlerts.length}</Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/15 bg-[#0d0a00] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Bell className="h-4 w-4 text-red-400" />
            Price Alerts — {symbol}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current price */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center">
            <span className="text-[10px] uppercase tracking-wider text-white/40">Current Price</span>
            <p className="font-mono text-lg font-bold text-amber-400">
              {currentPrice > 0
                ? currentPrice >= 1000
                  ? currentPrice.toFixed(2)
                  : currentPrice.toFixed(5)
                : "—"}
            </p>
          </div>

          {/* Set new alert — just a price, no above/below */}
          <div className="space-y-2">
            <Label className="text-xs text-white/60">Alert Price (trigger on touch)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.00001"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Enter price..."
                className="border-white/15 bg-white/5 font-mono text-sm text-white"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <Button
                onClick={handleAdd}
                size="sm"
                className="shrink-0 bg-red-600 text-white hover:bg-red-700"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPrice(currentPrice.toString())}
              className="h-6 px-2 text-[10px] text-white/40 hover:text-white"
            >
              Use current price
            </Button>
          </div>

          {/* Active alerts */}
          {activeAlerts.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-white/60">Active Alerts ({activeAlerts.length})</Label>
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.01] px-3 py-2"
                >
                  <span className="font-mono text-xs text-white/80">
                    <span className="text-amber-400">●</span> {alert.price}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveAlert(alert.id)}
                    className="h-6 w-6 p-0 text-white/30 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Triggered alerts */}
          {triggeredAlerts.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-white/40">Triggered ({triggeredAlerts.length})</Label>
              {triggeredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.01] px-3 py-2 opacity-50"
                >
                  <span className="font-mono text-xs text-white/60">
                    <span className="text-white/40">✓</span> {alert.price}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveAlert(alert.id)}
                    className="h-6 w-6 p-0 text-white/30 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {activeAlerts.length === 0 && triggeredAlerts.length === 0 && (
            <p className="py-4 text-center text-xs text-white/30">
              No alerts set. Enter a price above to get notified when price touches it.
            </p>
          )}

          {alerts.length > 0 && (
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                className="text-xs text-white/40 hover:text-red-400"
              >
                Clear All
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
