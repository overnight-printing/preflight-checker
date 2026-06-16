import os
import re

replacements = {
    "파일을 저장하는 중 오류가 발생했습니다.": "Error saving file.",
    "홈페이지로 이동": "Go to Homepage",
    "라이트 모드": "Light Mode",
    "다크 모드": "Dark Mode",
    "시스템 설정 따름": "System Default",
    "<span>자동</span>": "<span>Auto</span>",
    r"<span[^>]*>100% 브라우저 자체 처리 \(보안 안전\)</span>": "",
    "편집 및 조절 도구": "Edit & Adjust",
    r"<p[^>]*>유니언버그 위치와 디자인을 세팅하세요</p>": "",
    "<span>프리플라이트</span>": "<span>Preflight</span>",
    "<span>스탬퍼 설정</span>": "<span>Stamper Settings</span>",
    "파일 생성 중...": "Generating file...",
    "최종 결과물 저장하기": "Save Final Output",
    r"<p[^>]*>\*\s*\{bugEnabled \? '유니언버그와 ' : ''\}프리플라이트 수정 사항이 모두 반영됩니다\.</p>": "",
    "파일을 렌더링하고 레이아웃을 불러오는 중...": "Rendering and loading layout...",
    "아트워크 PDF/이미지 업로드": "Upload Artwork PDF/Image",
    "여기에 파일을 내려놓으면 자동으로 아트워크로 불러와 프리플라이트 검사를 진행합니다.": "Drop files here to load and run preflight checks.",
    "추천 색상 Palette": "Recommended Palette",
    "여백 추가 커트 (Manual)": "Manual Crop",
    "오류 (수정가능)": "Error (Fixable)",
    "인쇄 적합성 검사항목 (Preflight Checks)": "Preflight Checks",
    "이미지 해상도 (Image Resolution)": "Image Resolution",
    "도련 여백 설정 (Bleed)": "Bleed Margin",
    "오버프린트 설정 (Overprint)": "Overprint",
    "폰트 임베딩 (Font Embedding)": "Font Embedding",
    "색상 모드 (Color Mode)": "Color Mode",
    "페이지 규격 및 일치 여부 (Page Size)": "Page Size Match",
    "투명도 효과 (Transparency)": "Transparency",
    "별색 사용 여부 (Spot Colors)": "Spot Colors",
    "빈 페이지 확인 (Blank Pages)": "Blank Pages",
    "숨겨진 레이어 (Hidden Layers)": "Hidden Layers",
    "PDF 호환성 버전 (PDF Version)": "PDF Version",
    "페이지 규격이 일치하지 않습니다. 1페이지:": "Page size mismatch. Page 1:",
    "페이지:": "Page:",
    "모든 페이지 규격이 동일합니다:": "All pages have the same size:",
    "프리뷰 렌더링 해상도를 8.0 DPI (약 600 DPI 상당)로 대폭 상향하여 화면 Zoom In 시에도 칼같은 벡터 선명함 유지": "Preview rendering resolution increased to 8.0 DPI (approx. 600 DPI equivalent) to maintain crisp vector sharpness even when zoomed in."
}

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = content
    for k, v in replacements.items():
        if k.startswith('<p') or k.startswith('<span'):
            new_content = re.sub(k, v, new_content)
        else:
            new_content = new_content.replace(k, v)
            
    if content != new_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for root, dirs, files in os.walk('src'):
    for file in files:
        if file.endswith(('.js', '.jsx', '.html')):
            process_file(os.path.join(root, file))

