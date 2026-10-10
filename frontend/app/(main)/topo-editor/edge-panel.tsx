import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HANDLE_SIDES, type FlowEdge, type FlowEdgeData, type FlowNode, type InterfaceFamily } from "@/lib/topo/types";

export interface PortOption {
  value: string;
  label: string;
}

export interface EdgeEndpointDesc {
  id: "source" | "target";
  node: FlowNode | null;
  handle: string;
  interfaceValue: string;
  interfaceOptions: PortOption[];
  onHandleChange: (value: string) => void;
  onInterfaceChange: (value: string) => void;
}

interface EdgePanelProps {
  edge: FlowEdge;
  peers: FlowEdge[];
  family: InterfaceFamily;
  familyOptions: InterfaceFamily[];
  endpoints: EdgeEndpointDesc[];
  autoDescription: string;
  setSelectedEdgeId: (id: string | null) => void;
  updateEdge: (mutator: (data: FlowEdgeData) => FlowEdgeData) => void;
  onFamilyChange: (family: InterfaceFamily) => void;
}

export function EdgePanel({
  edge, peers, family, familyOptions, endpoints,
  autoDescription, setSelectedEdgeId, updateEdge, onFamilyChange,
}: EdgePanelProps) {
  const t = useTranslations("editor.edgePanel");
  return (
    <div className="space-y-4">
      {/* Multilink selector */}
      {peers.length > 1 && (
        <div>
          <FieldLabel>{t("multipleLinks")}</FieldLabel>
          <div className="flex flex-wrap gap-1">
            {peers.map((p, i) => (
              <Button key={p.id} size="sm" variant={p.id === edge.id ? "default" : "outline"} onClick={() => setSelectedEdgeId(p.id)}>
                {t("link", { n: i + 1 })}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Family */}
      <Field label={t("family")}>
        <Select value={family} onValueChange={(v) => onFamilyChange(v as InterfaceFamily)} disabled={familyOptions.length === 0}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent position="item-aligned">
            <SelectGroup>
              {familyOptions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {/* Endpoints (source + target side by side) */}
      <div className="grid grid-cols-2 gap-2">
        {endpoints.map((ep) => {
          const prefix = ep.id === "source" ? "s" : "t";
          return (
            <div key={ep.id} className="space-y-2 rounded border border-border p-2">
              <p className="text-xs font-medium text-foreground/80">{ep.node?.data.nlc.name ?? t("unknown")}</p>
              <Field label={t("handle")}>
                <Select value={ep.handle} onValueChange={ep.onHandleChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent position="item-aligned">
                    <SelectGroup>
                      {HANDLE_SIDES.map((side) => (
                        <SelectItem key={side} value={`${prefix}-${side}`}>{t(`sides.${side}`)}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("interface")}>
                <Select value={ep.interfaceValue} onValueChange={ep.onInterfaceChange} disabled={ep.interfaceOptions.length === 0}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent position="item-aligned">
                    <SelectGroup>
                      {ep.interfaceOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          );
        })}
      </div>

      {/* Description */}
      <Field label={t("description")}>
        <Input
          value={edge.data?.nlc?.description || autoDescription}
          onChange={(e) =>
            updateEdge((data) => ({ ...data, nlc: { ...data.nlc, description: e.target.value } }))
          }
        />
      </Field>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-xs font-medium text-muted-foreground">{children}</p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}
