import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/grade/' + url, ...arg)

export default {
	gradePage(data) {
		return request('page', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	gradeDelete(data) {
		return request('delete', data)
	},
	gradeDetail(data) {
		return request('detail', data, 'get')
	},
	gradeImportTemplate() {
		return request('importTemplate', {}, 'get', { responseType: 'blob' })
	},
	gradeImport(formData, dryRun = false) {
		return request(`import?dryRun=${dryRun}`, formData, 'post', {
			headers: { 'Content-Type': 'multipart/form-data' }
		})
	}
}
