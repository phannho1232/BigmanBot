export interface AnimatedMascotVariant {
  id: string;
  name: string;
  color: string;
  filename: string;
  url: string;
}

export const DEFAULT_ANIMATED_MASCOT_URL = "/mascots/nam_dam_dong_cam_goc.gif";

export const ANIMATED_FIST_MASCOTS: readonly AnimatedMascotVariant[] = [
  { id: "cam_goc", name: "Cam gốc", color: "#ff7a00", filename: "nam_dam_dong_cam_goc.gif", url: "/mascots/nam_dam_dong_cam_goc.gif" },
  { id: "hong", name: "Hồng sen", color: "#e33889", filename: "nam_dam_dong_hong.gif", url: "/mascots/nam_dam_dong_hong.gif" },
  { id: "hong_neon", name: "Hồng neon", color: "#ff1493", filename: "nam_dam_dong_hong_neon.gif", url: "/mascots/nam_dam_dong_hong_neon.gif" },
  { id: "cam_dao", name: "Cam đào", color: "#ff8c69", filename: "nam_dam_dong_cam_dao.gif", url: "/mascots/nam_dam_dong_cam_dao.gif" },
  { id: "ho_phach", name: "Vàng hổ phách", color: "#e8971e", filename: "nam_dam_dong_ho_phach.gif", url: "/mascots/nam_dam_dong_ho_phach.gif" },
  { id: "vang", name: "Vàng tươi", color: "#ffd700", filename: "nam_dam_dong_vang.gif", url: "/mascots/nam_dam_dong_vang.gif" },
  { id: "xanh_non_chuoi", name: "Xanh nõn chuối", color: "#8ce600", filename: "nam_dam_dong_xanh_non_chuoi.gif", url: "/mascots/nam_dam_dong_xanh_non_chuoi.gif" },
  { id: "bac_ha", name: "Xanh bạc hà", color: "#2ee695", filename: "nam_dam_dong_bac_ha.gif", url: "/mascots/nam_dam_dong_bac_ha.gif" },
  { id: "xanh_la", name: "Xanh lá", color: "#10b981", filename: "nam_dam_dong_xanh_la.gif", url: "/mascots/nam_dam_dong_xanh_la.gif" },
  { id: "luc_bao", name: "Xanh lục bảo", color: "#059669", filename: "nam_dam_dong_luc_bao.gif", url: "/mascots/nam_dam_dong_luc_bao.gif" },
  { id: "xanh_ngoc", name: "Xanh ngọc", color: "#06b6d4", filename: "nam_dam_dong_xanh_ngoc.gif", url: "/mascots/nam_dam_dong_xanh_ngoc.gif" },
  { id: "xanh_da_troi", name: "Xanh da trời", color: "#38bdf8", filename: "nam_dam_dong_xanh_da_troi.gif", url: "/mascots/nam_dam_dong_xanh_da_troi.gif" },
  { id: "xanh_duong", name: "Xanh dương", color: "#2563eb", filename: "nam_dam_dong_xanh_duong.gif", url: "/mascots/nam_dam_dong_xanh_duong.gif" },
  { id: "xanh_navy", name: "Xanh navy", color: "#1e3a8a", filename: "nam_dam_dong_xanh_navy.gif", url: "/mascots/nam_dam_dong_xanh_navy.gif" },
  { id: "tim_pastel", name: "Tím pastel", color: "#b388ff", filename: "nam_dam_dong_tim_pastel.gif", url: "/mascots/nam_dam_dong_tim_pastel.gif" },
  { id: "tim", name: "Tím đậm", color: "#8b5cf6", filename: "nam_dam_dong_tim.gif", url: "/mascots/nam_dam_dong_tim.gif" },
  { id: "do", name: "Đỏ tươi", color: "#ef4444", filename: "nam_dam_dong_do.gif", url: "/mascots/nam_dam_dong_do.gif" },
  { id: "do_ruby", name: "Đỏ ruby", color: "#9f1239", filename: "nam_dam_dong_do_ruby.gif", url: "/mascots/nam_dam_dong_do_ruby.gif" },
  { id: "xam_bac", name: "Xám bạc", color: "#94a3b8", filename: "nam_dam_dong_xam_bac.gif", url: "/mascots/nam_dam_dong_xam_bac.gif" },
] as const;
