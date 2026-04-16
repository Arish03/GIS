import { MapPin, Calendar, User, MoreHorizontal, CheckCircle2, Pencil } from 'lucide-react';
import { useState } from 'react';
import Badge from './ui/Badge';

export default function ProjectCard({ project, userRole, onContinue, onOpen, onEdit, onDelete, onReassign, onEditInfo }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isReviewPending = project.status === 'REVIEW_PENDING';
  const isActionable = ['DRAFT','CREATED','UNASSIGNED','UPLOADING','PROCESSING','REVIEW_PENDING','ERROR'].includes(project.status);
  const isReady = ['READY','REVIEW'].includes(project.status);
  const isSubAdmin = userRole === 'SUB_ADMIN';
  const isAdmin = userRole === 'ADMIN';
  const canDelete = !isSubAdmin;
  const canContinue = true;
  const canReview = isReviewPending && (isSubAdmin || isAdmin);

  return (
    <div className="relative bg-white/60 backdrop-blur-glass border border-white/80 rounded-2xl shadow-glass
                    hover:shadow-glass-hover hover:-translate-y-0.5 hover:border-primary-200
                    transition-all duration-200 overflow-hidden group">
      {/* Top accent on hover */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-400 to-teal-400
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <Badge status={project.status} />
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-40 bg-white/95 backdrop-blur-sm
                              border border-slate-200 rounded-xl shadow-glass-hover py-1"
                onClick={() => setMenuOpen(false)}>
                {isActionable && canContinue && (
                  <button onClick={onContinue} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Continue
                  </button>
                )}
                {isReady && (
                  <button onClick={onOpen} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Open
                  </button>
                )}
                {isReady && (
                  <button onClick={onEdit} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Edit Trees
                  </button>
                )}
                {onEditInfo && (isAdmin || isSubAdmin) && (
                  <button onClick={onEditInfo} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Edit Info
                  </button>
                )}
                {canReview && (
                  <button onClick={onEdit} className="w-full text-left px-4 py-2 text-sm text-primary-700 hover:bg-primary-50 font-medium">
                    Review &amp; Publish
                  </button>
                )}
                {isAdmin && onReassign && (
                  <>
                    <div className="border-t border-slate-100 my-1" />
                    <button onClick={onReassign} className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50">
                      Reassign Client
                    </button>
                  </>
                )}
                {canDelete && (
                  <>
                    <div className="border-t border-slate-100 my-1" />
                    <button onClick={onDelete} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50">
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Project name */}
        <h3 className="font-heading font-bold text-slate-800 text-base leading-snug mb-3">
          {project.name}
        </h3>

        {/* Meta info */}
        <div className="space-y-1.5 mb-4">
          {project.location && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <MapPin size={12} className="text-slate-400 shrink-0" />
              <span className="truncate">{project.location}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <User size={12} className="text-slate-400 shrink-0" />
            <span>{project.client_name || 'Unassigned'}</span>
          </div>
          {project.created_by_name && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <User size={12} className="text-slate-400 shrink-0" />
              <span className="truncate">Created by: {project.created_by_name}</span>
            </div>
          )}
          {project.reviewed_by_name && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 size={12} className="text-green-500 shrink-0" />
              <span className="truncate">Reviewed by: {project.reviewed_by_name}</span>
            </div>
          )}
          {project.last_edited_by_name && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Pencil size={12} className="text-amber-500 shrink-0" />
              <span className="truncate">Last edited by: {project.last_edited_by_name}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Calendar size={12} className="text-slate-400 shrink-0" />
            <span>{new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>

        {/* Action button */}
        <div className="pt-3 border-t border-slate-100">
          {canReview ? (
            <div className="flex gap-2">
              <button onClick={onEdit}
                className="flex-1 btn-primary btn-sm justify-center">
                Review
              </button>
              <button onClick={onContinue}
                className="flex-1 btn-secondary btn-sm justify-center">
                Details
              </button>
            </div>
          ) : isActionable && canContinue ? (
            <button onClick={onContinue}
              className="w-full btn-primary btn-sm justify-center">
              Continue →
            </button>
          ) : isReady ? (
            <div className="flex gap-2">
              <button onClick={onOpen}
                className="flex-1 btn-primary btn-sm justify-center">
                Open
              </button>
              <button onClick={onEdit}
                className="flex-1 btn-secondary btn-sm justify-center">
                Edit
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
