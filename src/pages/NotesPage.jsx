import React, { useState, useMemo, useDeferredValue } from "react";
import { Icon, Panel, EmptyState, parseMarkdownToHtml, prettyDate } from "../components/common.jsx";

function NotesPage(p){
  const [selected,setSelected]=useState(p.data.notes[0]?.id||""),[draft,setDraft]=useState(()=>p.data.notes[0]?{...p.data.notes[0]}:null);
  const [savingNote,setSavingNote]=useState(false),[deletingNote,setDeletingNote]=useState(false);
  const [searchQuery,setSearchQuery]=useState(""),[filterCourse,setFilterCourse]=useState(()=>p.routeQuery?.get?.("course")||"all");
  const deferredSearchQuery=useDeferredValue(searchQuery);
  // Default to preview mode when an existing note is selected/opened
  const [viewMode,setViewMode]=useState(()=>p.data.notes[0]?"preview":"edit");
  const [selectedCourseId,setSelectedCourseId]=useState(()=>{
    const first=p.data.notes[0];
    return first?.course_id||"";
  });
  const [sidebarOpen,setSidebarOpen]=useState(true);

  const note= p.data.notes.find(n=>n.id===selected);

  // Group all courses and their modules/lessons for structured selection
  const allCourses=p.data.courses||[];
  const allLessonsMap=useMemo(()=>{
    const map=new Map();
    allCourses.forEach(c=>{
      (c.modules||[]).forEach(m=>{
        (m.lessons||[]).forEach(l=>{
          map.set(l.id,{...l,courseId:c.id,courseTitle:c.title,moduleTitle:m.title});
        });
      });
    });
    return map;
  },[allCourses]);

  // Keep selected and draft synchronized with p.data.notes if notes change externally
  useEffect(()=>{
    if(selected){
      const stillExists=p.data.notes.find(n=>n.id===selected);
      if(!stillExists){
        const next=p.data.notes[0]||null;
        if(next){
          setSelected(next.id);
          setDraft({...next});
          const meta=next.lesson_id?allLessonsMap.get(next.lesson_id):null;
          setSelectedCourseId(meta?.courseId||next.course_id||"");
          setViewMode("preview");
        }else{
          setSelected("");
          setDraft(null);
          setSelectedCourseId("");
        }
      }
    }
  },[p.data.notes,selected,allLessonsMap]);

  const startNew=()=>{
    const activeLessonMeta=p.activeLesson?allLessonsMap.get(p.activeLesson.id):null;
    setSelected("");
    setSelectedCourseId(activeLessonMeta?.courseId||p.activeCourse?.id||"");
    setDraft({title:"",body:"",lesson_id:p.activeLesson?.id||"",source_ref:"",origin:"learner"});
    setViewMode("edit");
  };

  const open=(n)=>{
    setSelected(n.id);
    setDraft({...n});
    const lessonMeta=n.lesson_id?allLessonsMap.get(n.lesson_id):null;
    setSelectedCourseId(lessonMeta?.courseId||n.course_id||"");
    setViewMode("preview");
  };

  const insertMarkdown=(prefix,suffix="",placeholder="text")=>{
    const textarea=document.querySelector('.note-body-input');
    if(!textarea||!draft)return;
    const start=textarea.selectionStart,end=textarea.selectionEnd;
    const sel=draft.body.slice(start,end);
    const replacement=prefix+(sel||placeholder)+suffix;
    const nextBody=draft.body.slice(0,start)+replacement+draft.body.slice(end);
    setDraft({...draft,body:nextBody});
    setTimeout(()=>{
      textarea.focus();
      const cursorStart=start+prefix.length;
      const cursorEnd=cursorStart+(sel?sel.length:placeholder.length);
      textarea.setSelectionRange(cursorStart,cursorEnd);
    },10);
  };

  const handleSave=async()=>{
    if(!draft)return;
    setSavingNote(true);
    try{
      await p.saveNote({id:draft.id,title:draft.title,body:draft.body,lessonId:draft.lesson_id||null,sourceRef:draft.source_ref||"",origin:draft.origin||"learner"});
      setViewMode("preview");
    }finally{
      setSavingNote(false);
    }
  };

  const handleDelete=async()=>{
    if(!draft?.id)return;
    if(!confirm(`Delete "${draft.title||"this note"}"? This cannot be undone.`))return;
    const targetId=draft.id;
    setDeletingNote(true);
    try{
      await p.deleteNote(targetId);
      const remaining=p.data.notes.filter(n=>n.id!==targetId);
      const nextNote=remaining[0]||null;
      if(nextNote){
        setSelected(nextNote.id);
        setDraft({...nextNote});
        const meta=nextNote.lesson_id?allLessonsMap.get(nextNote.lesson_id):null;
        setSelectedCourseId(meta?.courseId||nextNote.course_id||"");
        setViewMode("preview");
      }else{
        setSelected("");
        setDraft(null);
        setSelectedCourseId("");
      }
    }finally{
      setDeletingNote(false);
    }
  };

  // Filter notes by search query and course (using React 19 useDeferredValue for responsive keystrokes)
  const filteredNotes=useMemo(()=>{
    return p.data.notes.filter(n=>{
      if(deferredSearchQuery.trim()){
        const q=deferredSearchQuery.toLowerCase();
        const matchTitle=(n.title||"").toLowerCase().includes(q);
        const matchBody=(n.body||"").toLowerCase().includes(q);
        const matchSource=(n.lesson_title||n.source_ref||"").toLowerCase().includes(q);
        if(!matchTitle&&!matchBody&&!matchSource)return false;
      }
      if(filterCourse!=="all"){
        if(filterCourse==="unlinked")return !n.lesson_id&&!n.course_id;
        const meta=n.lesson_id?allLessonsMap.get(n.lesson_id):null;
        const cId=meta?.courseId||n.course_id;
        if(cId!==filterCourse)return false;
      }
      return true;
    });
  },[p.data.notes,deferredSearchQuery,filterCourse,allLessonsMap]);

  // Available lessons for the currently selected course in the editor
  const availableLessons=useMemo(()=>{
    if(!selectedCourseId)return [];
    const crs=allCourses.find(c=>c.id===selectedCourseId);
    if(!crs)return [];
    const list=[];
    (crs.modules||[]).forEach((m,mIdx)=>{
      (m.lessons||[]).forEach((l,lIdx)=>{
        list.push({...l,label:`M${mIdx+1}: ${l.title}`});
      });
    });
    return list;
  },[allCourses,selectedCourseId]);

  return <div className={`notes-layout grid gap-4 items-start ${sidebarOpen?"sidebar-open":"sidebar-closed"}`}>
    {sidebarOpen&&(
      <aside className="notes-sidebar panel flex flex-col p-3 gap-2.5">
        <div className="panel-head flex items-center justify-between">
          <div className="panel-title flex items-center gap-2.5">
            <Icon name="notes"/>
            <span>All notes</span>
            <span className="count-pill">{p.data.notes.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="primary-btn compact" onClick={startNew}><Icon name="plus" size={13}/>New</button>
            <button
              type="button"
              className="notes-toggle-sidebar-btn"
              onClick={()=>setSidebarOpen(false)}
              aria-label="Hide notes sidebar"
              title="Collapse notes list"
            >
              <Icon name="chevronLeft" size={15}/>
            </button>
          </div>
        </div>

        <div className="notes-filter-bar flex flex-col gap-2 px-1">
          <div className="notes-search-box flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-learnos-bg/70 border border-learnos-line">
            <Icon name="search" size={14}/>
            <input
              type="search"
              value={searchQuery}
              onChange={e=>setSearchQuery(e.target.value)}
              placeholder="Search in notes…"
              aria-label="Search notes"
              className="w-full bg-transparent border-0 outline-none text-xs text-learnos-text placeholder-learnos-muted"
            />
            {searchQuery&&<button type="button" className="text-xs text-learnos-muted hover:text-white" onClick={()=>setSearchQuery("")}>×</button>}
          </div>

          {allCourses.length>0&&(
            <div className="notes-course-filter flex items-center gap-1.5">
              <span className="text-xs text-learnos-muted font-medium shrink-0">Filter:</span>
              <select
                value={filterCourse}
                onChange={e=>setFilterCourse(e.target.value)}
                aria-label="Filter notes by course"
                className="notes-filter-select w-full text-xs rounded-lg px-2 py-1 bg-learnos-bg/70 border border-learnos-line text-learnos-text"
              >
                <option value="all">All courses ({p.data.notes.length})</option>
                {allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
                <option value="unlinked">Personal / Unlinked</option>
              </select>
            </div>
          )}
        </div>

        <div className="notes-list-scroll flex flex-col gap-1 overflow-y-auto max-h-[560px]">
          {p.data.notes.length===0?<p className="muted-copy padded">No notes saved yet.</p>:
           filteredNotes.length===0?<div className="p-4 text-center text-xs text-learnos-muted">No notes match your filter. <button type="button" className="text-learnos-purple underline ml-1" onClick={()=>{setSearchQuery("");setFilterCourse("all");}}>Clear</button></div>:
           filteredNotes.map(n=><button key={n.id} className={`note-list-item flex flex-col text-left p-3 cursor-pointer ${selected===n.id?"active":""}`} onClick={()=>open(n)} aria-label={`Note: ${n.title}`}>
            <div className="flex items-center justify-between gap-2 w-full">
              <strong>{n.title}</strong>
              {n.origin==="ai_draft"&&<span className="ai-draft-badge" title="Drafted by AI — ready for you to personalize"><Icon name="spark" size={10}/>AI DRAFT</span>}
              {n.origin==="roadmap"&&<span className="ai-draft-badge roadmap" title="Created from course roadmap"><Icon name="spark" size={10}/>ROADMAP</span>}
            </div>
            <span>{n.lesson_title||n.source_ref||"Personal note"}</span>
            <small>{prettyDate(n.updated_at,{month:"short",day:"numeric"})}</small>
          </button>)}
        </div>
      </aside>
    )}

    <section className="note-editor panel flex flex-col p-4 gap-3">
      {!sidebarOpen&&(
        <div className="notes-collapsed-bar flex items-center justify-between pb-2 mb-1 border-b border-learnos-line/50">
          <button
            type="button"
            className="notes-expand-sidebar-btn flex items-center gap-2 text-xs font-semibold text-learnos-muted hover:text-white"
            onClick={()=>setSidebarOpen(true)}
          >
            <Icon name="chevronRight" size={14}/>
            <span>Show all notes ({p.data.notes.length})</span>
          </button>
          <button className="primary-btn compact" onClick={startNew}><Icon name="plus" size={13}/>New note</button>
        </div>
      )}

      {draft?<>
        <div className="note-editor-top flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="eyebrow">{draft.lesson_title||(selectedCourseId?allCourses.find(c=>c.id===selectedCourseId)?.title:"LEARNER NOTE")}</span>
              {(draft.origin==="ai_draft"||note?.origin==="ai_draft")&&<span className="ai-draft-badge" title="Drafted by AI — ready for you to personalize"><Icon name="spark" size={11}/>AI DRAFT</span>}
              {(draft.origin==="roadmap"||note?.origin==="roadmap")&&<span className="ai-draft-badge roadmap" title="Created from course roadmap"><Icon name="spark" size={11}/>ROADMAP</span>}
            </div>
          </div>

          <div className="note-actions flex items-center gap-2.5">
            <div className="note-view-toggle" role="tablist">
              <button
                type="button"
                className={`note-toggle-btn ${viewMode==="preview"?"active":""}`}
                onClick={()=>setViewMode("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                className={`note-toggle-btn ${viewMode==="edit"?"active":""}`}
                onClick={()=>setViewMode("edit")}
              >
                Write
              </button>
            </div>
            {draft.id&&<button className="danger-btn compact note-delete-btn" disabled={deletingNote||savingNote} onClick={handleDelete}>{deletingNote?<><span className="btn-spinner"/> Deleting…</>:"Delete"}</button>}
            <button className="primary-btn" disabled={savingNote||deletingNote} onClick={handleSave}>{savingNote?<><span className="btn-spinner"/> Saving…</>:"Save note"}</button>
          </div>
        </div>

        <input className="note-title-input" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="Untitled note" aria-label="Note title"/>

        {viewMode==="edit"&&(
          <div className="markdown-toolbar flex items-center gap-1 p-1.5 rounded-lg bg-learnos-bg/60 border border-learnos-line flex-wrap text-xs text-learnos-muted">
            <button type="button" className="md-tool-btn" title="Bold (**text**)" onClick={()=>insertMarkdown("**","**","bold")}><strong>B</strong></button>
            <button type="button" className="md-tool-btn" title="Italic (*text*)" onClick={()=>insertMarkdown("*","*","italic")}><em>I</em></button>
            <span className="md-sep"/>
            <button type="button" className="md-tool-btn" title="Heading 1 (# Heading)" onClick={()=>insertMarkdown("# ","","Heading 1")}>H1</button>
            <button type="button" className="md-tool-btn" title="Heading 2 (## Heading)" onClick={()=>insertMarkdown("## ","","Heading 2")}>H2</button>
            <button type="button" className="md-tool-btn" title="Heading 3 (### Heading)" onClick={()=>insertMarkdown("### ","","Heading 3")}>H3</button>
            <span className="md-sep"/>
            <button type="button" className="md-tool-btn" title="Bulleted list (- item)" onClick={()=>insertMarkdown("- ","","List item")}>• List</button>
            <button type="button" className="md-tool-btn" title="Numbered list (1. item)" onClick={()=>insertMarkdown("1. ","","Numbered item")}>1. List</button>
            <button type="button" className="md-tool-btn" title="Blockquote (> quote)" onClick={()=>insertMarkdown("> ","","Quote")}>“ Quote</button>
            <button type="button" className="md-tool-btn" title="Code snippet (`code`)" onClick={()=>insertMarkdown("`","`","code")}>&lt;/&gt;</button>
            <button type="button" className="md-tool-btn" title="Code block (```)" onClick={()=>insertMarkdown("```\n","\n```","code here")}>Code block</button>
          </div>
        )}

        {viewMode==="edit"?(
          <textarea className="note-body-input" value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} placeholder="Write down the idea in your own words with Markdown (headings, lists, code)…" aria-label="Note body"/>
        ):(
          <div
            className="note-markdown-preview reading-copy flex flex-col gap-3 p-4 min-h-[260px] rounded-xl bg-learnos-bg/40 border border-learnos-line/70 overflow-y-auto"
            dangerouslySetInnerHTML={{__html:parseMarkdownToHtml(draft.body)||"<em>No content written yet. Switch to Write to begin.</em>"}}
          />
        )}

        <div className="note-source-row note-link-card">
          <div className="note-link-head">
            <span className="note-link-kicker">Course & Lesson Link</span>
          </div>

          <div className="note-link-fields">
            <label className="note-field-group">
              <span className="note-field-label">Course</span>
              <select
                value={selectedCourseId}
                onChange={e=>{
                  const nextCourseId=e.target.value;
                  setSelectedCourseId(nextCourseId);
                  if(!nextCourseId){
                    setDraft({...draft,lesson_id:"",lesson_title:"",course_id:null});
                  }else{
                    setDraft({...draft,course_id:nextCourseId,lesson_id:"",lesson_title:""});
                  }
                }}
                className="note-link-select"
              >
                <option value="">Personal note (no course)</option>
                {allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>

            {Boolean(selectedCourseId)&&(
              <label className="note-field-group animate-fadeIn">
                <span className="note-field-label">Topic / Lesson</span>
                <select
                  value={draft.lesson_id||""}
                  onChange={e=>{
                    const lId=e.target.value;
                    const meta=allLessonsMap.get(lId);
                    setDraft({
                      ...draft,
                      lesson_id:lId||"",
                      lesson_title:meta?.title||"",
                      source_ref:meta?.title||draft.source_ref||""
                    });
                  }}
                  className="note-link-select"
                >
                  <option value="">Whole course / general note</option>
                  {availableLessons.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      </>:
      <EmptyState title="Choose a note to edit" body="Select a note, or make a new one to capture an idea while it is fresh." action="New note" onAction={startNew}/>}
    </section>
  </div>;
}

export { NotesPage };
